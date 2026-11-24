pub(super) fn validate_cookie(value: &super::protocol::Cookie) -> Result<(), super::Error> {
    super::protocol::CookieSameSite::try_from(value.same_site).map_err(|_| {
        super::Error::invalid_response(
            "cookie same site",
            serde_json::json!({ "value": value.same_site }),
        )
    })?;
    super::protocol::CookiePriority::try_from(value.priority).map_err(|_| {
        super::Error::invalid_response(
            "cookie priority",
            serde_json::json!({ "value": value.priority }),
        )
    })?;
    super::protocol::CookieSourceScheme::try_from(value.source_scheme).map_err(|_| {
        super::Error::invalid_response(
            "cookie source scheme",
            serde_json::json!({ "value": value.source_scheme }),
        )
    })?;
    if let Some(expires) = value.expires {
        decode_timestamp(expires)?;
    }
    Ok(())
}

#[test]
fn invalid_cookie_values_are_rejected_before_session_transfer() {
    struct Case {
        cookie: super::protocol::Cookie,
        field: &'static str,
    }
    for Case { cookie, field } in [
        Case {
            cookie: super::protocol::Cookie {
                same_site: 999,
                ..Default::default()
            },
            field: "cookie same site",
        },
        Case {
            cookie: super::protocol::Cookie {
                priority: 999,
                ..Default::default()
            },
            field: "cookie priority",
        },
        Case {
            cookie: super::protocol::Cookie {
                source_scheme: 999,
                ..Default::default()
            },
            field: "cookie source scheme",
        },
    ] {
        assert!(matches!(validate_cookie(&cookie),
            Err(super::Error::InvalidResponse { field: actual, details, .. })
                if actual == field && details == serde_json::json!({ "value": 999 })
        ));
    }
    for expires in [
        prost_types::Timestamp {
            seconds: 0,
            nanos: -1,
        },
        prost_types::Timestamp {
            seconds: 253_402_300_800,
            nanos: 0,
        },
    ] {
        let mut cookie = create_cookie(".google.com");
        cookie.expires = Some(expires);
        assert!(matches!(
            validate_cookie(&cookie),
            Err(super::Error::InvalidResponse {
                field: "timestamp",
                ..
            })
        ));
        assert!(matches!(
            create_cookie_store(vec![cookie]),
            Err(super::Error::InvalidResponse {
                field: "timestamp",
                ..
            })
        ));
    }
}

fn decode_timestamp(
    value: prost_types::Timestamp,
) -> Result<chrono::DateTime<chrono::Utc>, super::Error> {
    crate::rpc::decode_timestamp(value).ok_or_else(|| {
        super::Error::invalid_response(
            "timestamp",
            serde_json::json!({ "seconds": value.seconds, "nanos": value.nanos }),
        )
    })
}

pub(super) fn create_cookie_store(
    cookies: Vec<super::protocol::Cookie>,
) -> Result<reqwest_cookie_store::CookieStoreMutex, super::Error> {
    let mut store = reqwest_cookie_store::CookieStore::new();
    for cookie in cookies {
        let host = cookie.domain.trim_start_matches('.');
        if cookie.partition_key.is_some()
            || !["google.com", "google.co.jp", "googleusercontent.com"]
                .iter()
                .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
        {
            continue;
        }
        let origin = url::Url::parse(&format!("https://{host}/")).map_err(|source| {
            super::Error::InvalidResponse {
                field: "Google cookie origin",
                details: serde_json::Value::Null,
                source: Some(Box::new(source)),
            }
        })?;
        let mut raw = reqwest_cookie_store::RawCookie::build((cookie.name, cookie.value))
            .path(cookie.path)
            .secure(cookie.secure)
            .http_only(cookie.http_only);
        if cookie.domain.starts_with('.') {
            raw = raw.domain(cookie.domain);
        }
        if let Some(expires) = cookie.expires {
            let expires: time::OffsetDateTime =
                std::time::SystemTime::from(decode_timestamp(expires)?).into();
            raw = raw.expires(expires);
        }
        store.store_response_cookies(std::iter::once(raw.build()), &origin);
    }
    Ok(reqwest_cookie_store::CookieStoreMutex::new(store))
}

#[cfg(test)]
fn create_cookie(domain: &str) -> super::protocol::Cookie {
    super::protocol::Cookie {
        name: "SID".into(),
        value: "test".into(),
        domain: domain.into(),
        path: "/".into(),
        secure: true,
        http_only: true,
        ..Default::default()
    }
}

#[test]
fn browser_cookie_conversion_preserves_scope_and_excludes_unusable_cookies() {
    use reqwest::cookie::CookieStore as _;

    let mut scoped = create_cookie("drive.google.com");
    scoped.name = "SCOPED".into();
    scoped.path = "/uc".into();
    let mut expired = create_cookie(".google.com");
    expired.name = "EXPIRED".into();
    expired.expires = Some(prost_types::Timestamp {
        seconds: 1,
        nanos: 0,
    });
    let mut partitioned = create_cookie(".google.com");
    partitioned.name = "PARTITIONED".into();
    partitioned.partition_key = Some(Default::default());
    let mut future = create_cookie(".google.com");
    future.name = "FUTURE".into();
    future.expires = Some(prost_types::Timestamp {
        seconds: chrono::Utc::now().timestamp() + 3600,
        nanos: 0,
    });
    let store = create_cookie_store(vec![
        create_cookie(".google.com"),
        scoped,
        expired,
        partitioned,
        future,
        create_cookie("evil.example"),
        create_cookie("google.com.evil.example"),
    ])
    .unwrap();
    let values = |url| {
        store
            .cookies(&url::Url::parse(url).unwrap())
            .map(|value| value.to_str().unwrap().to_owned())
            .unwrap_or_default()
    };
    let download = values("https://drive.google.com/uc");
    assert!(download.contains("SID=test"));
    assert!(download.contains("SCOPED=test"));
    assert!(download.contains("FUTURE=test"));
    assert!(!download.contains("EXPIRED"));
    assert!(!download.contains("PARTITIONED"));
    assert!(!values("https://accounts.google.com/").contains("SCOPED"));
    assert!(!values("https://drive.google.com/elsewhere").contains("SCOPED"));
    assert_eq!(values("https://evil.example/"), "");
    assert_eq!(values("https://google.com.evil.example/"), "");
    assert_eq!(values("http://drive.google.com/uc"), "");
    let empty = create_cookie_store(Vec::new()).unwrap();
    assert!(
        empty
            .cookies(&url::Url::parse("https://drive.google.com/uc").unwrap())
            .is_none()
    );
}
