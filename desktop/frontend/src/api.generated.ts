export interface paths {
  "/assignments": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Read or synchronize assignments
     * @description Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.
     */
    get: operations["listAssignments"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/auth": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read cached authentication state */
    get: operations["getCachedAuthenticationState"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/auth/check": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Check LMS authentication
     * @description Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.
     */
    post: operations["checkAuthentication"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/auth/google": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read cached Google authentication state */
    get: operations["getCachedGoogleAuthenticationState"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/auth/google/check": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Check the saved Google session
     * @description Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.
     */
    post: operations["checkGoogleAuthentication"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/auth/google/login": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Log in to Google and save the session
     * @description Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.
     */
    post: operations["googleLogin"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/auth/login": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Log in to LMS
     * @description Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.
     */
    post: operations["login"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/auth/webauthn": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read saved WebAuthn credential state */
    get: operations["getWebAuthn"];
    put?: never;
    /**
     * Register virtual WebAuthn credential
     * @description Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.
     */
    post: operations["registerWebAuthn"];
    /**
     * Delete saved WebAuthn credential
     * @description Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.
     */
    delete: operations["deleteWebAuthn"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/courses": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Read or synchronize courses
     * @description Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.
     */
    get: operations["listCourses"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/courses/{courseId}/materials": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Read or synchronize course materials
     * @description Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.
     */
    get: operations["listMaterials"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/healthz": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Check HTTP process */
    get: operations["health"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/materials/{materialId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Read or synchronize material details
     * @description Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.
     */
    get: operations["getMaterial"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/materials/{materialId}/resources/{resourceId}/download": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Acquire and save a resource
     * @description Returns SSE status events followed by exactly one result or error event, then closes. Disconnecting detaches observation; execution continues. Repeat the request to observe equivalent active work.
     */
    post: operations["downloadResource"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/materials/{materialId}/resources/{resourceId}/file": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Serve a saved file */
    get: operations["getSavedFile"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    /** Serve a saved file */
    head: operations["headSavedFile"];
    patch?: never;
    trace?: never;
  };
  "/materials/{materialId}/resources/{resourceId}/prepare": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Materialize a saved resource for local clients */
    post: operations["prepareResource"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    Assignment: {
      folderName: string;
      lmsCourseId: string;
      material: components["schemas"]["Material"];
    };
    AssignmentsResult: {
      assignments: components["schemas"]["Assignment"][] | null;
      failures: components["schemas"]["CourseFailure"][] | null;
    };
    AuthInputBody: {
      /**
       * @description Allow manual authentication in a visible browser on the server machine.
       * @default false
       */
      interactive: boolean;
    };
    AuthState: {
      /** @enum {string} */
      status: "unknown" | "authenticated" | "unauthenticated";
    };
    Course: {
      /** Format: int64 */
      academicYear?: number;
      archived?: boolean;
      /** @enum {string} */
      availability: "available" | "unavailable";
      lmsCourseId?: string;
      name: string;
      /** Format: int64 */
      period?: number;
      /** @enum {string} */
      type?: "scheduled" | "other" | "unknown";
      /** Format: int64 */
      weekday?: number;
    };
    CourseFailure: {
      error: components["schemas"]["Error"];
      lmsCourseId: string;
    };
    CourseMaterials: {
      folders: components["schemas"]["Folder"][] | null;
      lmsCourseId: string;
    };
    DataBodyAssignmentsResult: {
      data: components["schemas"]["AssignmentsResult"];
    };
    DataBodyAuthState: {
      data: components["schemas"]["AuthState"];
    };
    DataBodyCourseMaterials: {
      data: components["schemas"]["CourseMaterials"];
    };
    DataBodyDetail: {
      data: components["schemas"]["Detail"];
    };
    DataBodyDownloadResult: {
      data: components["schemas"]["FileDownload"] | components["schemas"]["ExternalDownload"];
    };
    DataBodyListCourse: {
      data: components["schemas"]["Course"][] | null;
    };
    DataBodyRegistrationResult: {
      data: components["schemas"]["RegistrationResult"];
    };
    DataBodyResourcePath: {
      data: components["schemas"]["ResourcePath"];
    };
    Detail: {
      course: components["schemas"]["Course"];
      material: components["schemas"]["Material"];
      report?: components["schemas"]["ReportDetail"];
      resources: components["schemas"]["Resource"][] | null;
    };
    Error: {
      message: string;
      /** @enum {string} */
      reason:
        | "invalid-input"
        | "conflict"
        | "authentication-required"
        | "archive-data-missing"
        | "material-not-found"
        | "resource-not-found"
        | "course-not-found"
        | "unsupported-resource"
        | "source"
        | "timeout"
        | "internal"
        | "archive"
        | "authentication-storage"
        | "resource-storage"
        | "not-found"
        | "forbidden"
        | "browser-start";
    };
    ErrorBody: {
      error: components["schemas"]["Error"];
    };
    ErrorDetail: {
      /** @description Where the error occurred, e.g. 'body.items[3].tags' or 'path.thing-id' */
      location?: string;
      /** @description Error message text */
      message?: string;
      /** @description The value at the given location */
      value?: unknown;
    };
    ErrorModel: {
      /**
       * @description A human-readable explanation specific to this occurrence of the problem.
       * @example Property foo is required but is missing.
       */
      detail?: string;
      /** @description Optional list of individual error details */
      errors?: components["schemas"]["ErrorDetail"][] | null;
      /**
       * Format: uri
       * @description A URI reference that identifies the specific occurrence of the problem.
       * @example https://example.com/error-log/abc123
       */
      instance?: string;
      /**
       * Format: int64
       * @description HTTP status code
       * @example 400
       */
      status?: number;
      /**
       * @description A short, human-readable summary of the problem type. This value should not change between occurrences of the error.
       * @example Bad Request
       */
      title?: string;
      /**
       * Format: uri
       * @description A URI reference to human-readable documentation for the error.
       * @default about:blank
       * @example https://example.com/errors/example
       */
      type: string;
    };
    ExternalDownload: {
      /** @enum {string} */
      type: "external";
      /** Format: uri */
      url: string;
    };
    FileDownload: {
      downloadUrl: string;
      file: components["schemas"]["SavedFile"];
      /** @enum {string} */
      type: "file";
    };
    Folder: {
      /** Format: date */
      classDate?: string;
      descriptionHtml?: string;
      materials: components["schemas"]["Material"][] | null;
      name: string;
    };
    HealthResponseBody: {
      /** @enum {string} */
      service: "ku-potato-server";
      /** @enum {string} */
      status: "ok";
    };
    Material:
      | {
          archived?: boolean;
          /** Format: date-time */
          fetchedAt?: string;
          lmsMaterialId: string;
          materialLinkAvailable: boolean;
          name: string;
          publicationDeadline: string;
          /** Format: date-time */
          publicationDeadlineAt?: string;
          /** @enum {string} */
          publicationDeadlineKind?: "at" | "unlisted" | "closed" | "unknown";
          /** @enum {string} */
          resourceAvailability?: "available" | "unavailable";
          /** @enum {string} */
          status: "unviewed" | "viewed" | "partially-viewed" | "unknown";
          /** @enum {string} */
          type: "material";
        }
      | {
          archived?: boolean;
          /** Format: date-time */
          fetchedAt?: string;
          lmsMaterialId: string;
          materialLinkAvailable: boolean;
          name: string;
          publicationDeadline: string;
          /** Format: date-time */
          publicationDeadlineAt?: string;
          /** @enum {string} */
          publicationDeadlineKind?: "at" | "unlisted" | "closed" | "unknown";
          /** @enum {string} */
          resourceAvailability?: "available" | "unavailable";
          /** @enum {string} */
          status:
            | "unviewed"
            | "unsubmitted"
            | "submitted"
            | "resubmission-required"
            | "evaluated"
            | "unknown";
          /** @enum {string} */
          type: "report";
        }
      | {
          archived?: boolean;
          /** Format: date-time */
          fetchedAt?: string;
          lmsMaterialId: string;
          materialLinkAvailable: boolean;
          name: string;
          publicationDeadline: string;
          /** Format: date-time */
          publicationDeadlineAt?: string;
          /** @enum {string} */
          publicationDeadlineKind?: "at" | "unlisted" | "closed" | "unknown";
          /** @enum {string} */
          resourceAvailability?: "available" | "unavailable";
          /** @enum {string} */
          status: "not-started" | "in-progress" | "completed" | "unknown";
          /** @enum {string} */
          type: "test";
        }
      | {
          archived?: boolean;
          /** Format: date-time */
          fetchedAt?: string;
          lmsMaterialId: string;
          materialLinkAvailable: boolean;
          name: string;
          publicationDeadline: string;
          /** Format: date-time */
          publicationDeadlineAt?: string;
          /** @enum {string} */
          publicationDeadlineKind?: "at" | "unlisted" | "closed" | "unknown";
          /** @enum {string} */
          resourceAvailability?: "available" | "unavailable";
          /** @enum {string} */
          status: "unanswered" | "answered" | "unknown";
          /** @enum {string} */
          type: "questionnaire";
        }
      | {
          archived?: boolean;
          /** Format: date-time */
          fetchedAt?: string;
          lmsMaterialId: string;
          materialLinkAvailable: boolean;
          name: string;
          publicationDeadline: string;
          /** Format: date-time */
          publicationDeadlineAt?: string;
          /** @enum {string} */
          publicationDeadlineKind?: "at" | "unlisted" | "closed" | "unknown";
          /** @enum {string} */
          resourceAvailability?: "available" | "unavailable";
          /** @enum {string} */
          status: "not-started" | "in-progress" | "completed" | "unknown";
          /** @enum {string} */
          type: "e-learning";
        }
      | {
          archived?: boolean;
          /** Format: date-time */
          fetchedAt?: string;
          lmsMaterialId: string;
          materialLinkAvailable: boolean;
          name: string;
          publicationDeadline: string;
          /** Format: date-time */
          publicationDeadlineAt?: string;
          /** @enum {string} */
          publicationDeadlineKind?: "at" | "unlisted" | "closed" | "unknown";
          /** @enum {string} */
          resourceAvailability?: "available" | "unavailable";
          /** @enum {string} */
          status: "unposted" | "evaluated" | "unknown";
          /** @enum {string} */
          type: "board";
        }
      | {
          archived?: boolean;
          /** Format: date-time */
          fetchedAt?: string;
          lmsMaterialId: string;
          materialLinkAvailable: boolean;
          name: string;
          publicationDeadline: string;
          /** Format: date-time */
          publicationDeadlineAt?: string;
          /** @enum {string} */
          publicationDeadlineKind?: "at" | "unlisted" | "closed" | "unknown";
          /** @enum {string} */
          resourceAvailability?: "available" | "unavailable";
          /** @enum {string} */
          status: "unevaluated" | "evaluated" | "unknown";
          /** @enum {string} */
          type: "feedback";
        }
      | {
          archived?: boolean;
          /** Format: date-time */
          fetchedAt?: string;
          lmsMaterialId: string;
          materialLinkAvailable: boolean;
          name: string;
          publicationDeadline: string;
          /** Format: date-time */
          publicationDeadlineAt?: string;
          /** @enum {string} */
          publicationDeadlineKind?: "at" | "unlisted" | "closed" | "unknown";
          /** @enum {string} */
          resourceAvailability?: "available" | "unavailable";
          /** @enum {string} */
          status: "unknown";
          /** @enum {string} */
          type: "unknown";
        };
    OperationStatus: {
      /** Format: int64 */
      attempt: number;
      error?: components["schemas"]["Error"];
      progress?: components["schemas"]["Progress"];
      /** @enum {string} */
      status: "queued" | "running" | "retrying" | "succeeded" | "failed" | "blocked";
    };
    Progress: {
      /** Format: int64 */
      completed: number;
      lmsCourseId?: string;
      /** @enum {string} */
      stage:
        | "waiting"
        | "authenticating"
        | "logging-out"
        | "registering"
        | "fetching-courses"
        | "fetching-materials"
        | "fetching-resources"
        | "downloading"
        | "saving"
        | "completed";
      /** Format: int64 */
      total: number;
    };
    RegistrationResult: {
      registered: boolean;
    };
    ReportDetail: {
      /** Format: int64 */
      correctionLimit?: number;
      /** @enum {string} */
      correctionMode: "unknown" | "not-allowed" | "unlimited" | "limited";
      /** Format: date-time */
      fetchedAt?: string;
      fileAnswerAllowed?: boolean;
      /** Format: int64 */
      maxTotalFileBytes?: number;
      promptHtml?: string;
      /** @enum {string} */
      status:
        | "unviewed"
        | "unsubmitted"
        | "submitted"
        | "resubmission-required"
        | "evaluated"
        | "unknown";
      /** Format: date-time */
      submissionDueAt?: string;
      /** @enum {string} */
      submissionPeriodKind: "at" | "unlisted" | "unknown";
      /** Format: date-time */
      submissionStartsAt?: string;
      textAnswerAllowed?: boolean;
    };
    Resource: {
      /** @enum {string} */
      availability: "current" | "archived";
      description?: string;
      /** Format: date */
      firstViewedOn?: string;
      lmsResourceId: string;
      name: string;
      /** Format: date */
      registeredOn?: string;
      savedFile?: components["schemas"]["SavedFile"];
      /** @enum {string} */
      status?: "unviewed" | "viewed" | "unknown";
      /** @enum {string} */
      type: "file" | "external" | "unknown";
      /** Format: uri */
      url?: string;
    };
    ResourcePath: {
      path: string;
    };
    SavedFile: {
      id: string;
      originalFilename: string;
      sha256: string;
      /** Format: int64 */
      size: number;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  listAssignments: {
    parameters: {
      query?: {
        /** @description auto reads saved data or starts synchronization; false reads only; true starts synchronization. */
        sync?: "auto" | "true" | "false";
        /** @description Repeat to select courses; omission selects all saved courses. */
        courseId?: string[] | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": (
            | {
                data: components["schemas"]["ErrorBody"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "error";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["DataBodyAssignmentsResult"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "result";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["OperationStatus"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "status";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
          )[];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
    };
  };
  getCachedAuthenticationState: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["DataBodyAuthState"];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
    };
  };
  checkAuthentication: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": (
            | {
                data: components["schemas"]["ErrorBody"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "error";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["DataBodyAuthState"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "result";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["OperationStatus"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "status";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
          )[];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
    };
  };
  getCachedGoogleAuthenticationState: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["DataBodyAuthState"];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
    };
  };
  checkGoogleAuthentication: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": (
            | {
                data: components["schemas"]["ErrorBody"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "error";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["DataBodyAuthState"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "result";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["OperationStatus"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "status";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
          )[];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
    };
  };
  googleLogin: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["AuthInputBody"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": (
            | {
                data: components["schemas"]["ErrorBody"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "error";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["DataBodyAuthState"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "result";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["OperationStatus"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "status";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
          )[];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
    };
  };
  login: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["AuthInputBody"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": (
            | {
                data: components["schemas"]["ErrorBody"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "error";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["DataBodyAuthState"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "result";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["OperationStatus"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "status";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
          )[];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
    };
  };
  getWebAuthn: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["DataBodyRegistrationResult"];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
    };
  };
  registerWebAuthn: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["AuthInputBody"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": (
            | {
                data: components["schemas"]["ErrorBody"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "error";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["DataBodyRegistrationResult"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "result";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["OperationStatus"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "status";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
          )[];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
    };
  };
  deleteWebAuthn: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": (
            | {
                data: components["schemas"]["ErrorBody"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "error";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["DataBodyRegistrationResult"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "result";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["OperationStatus"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "status";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
          )[];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
    };
  };
  listCourses: {
    parameters: {
      query?: {
        /** @description auto reads saved data or starts synchronization; false reads only; true starts synchronization. */
        sync?: "auto" | "true" | "false";
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": (
            | {
                data: components["schemas"]["ErrorBody"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "error";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["DataBodyListCourse"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "result";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["OperationStatus"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "status";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
          )[];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
    };
  };
  listMaterials: {
    parameters: {
      query?: {
        /** @description auto reads saved data or starts synchronization; false reads only; true starts synchronization. */
        sync?: "auto" | "true" | "false";
      };
      header?: never;
      path: {
        courseId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": (
            | {
                data: components["schemas"]["ErrorBody"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "error";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["DataBodyCourseMaterials"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "result";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["OperationStatus"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "status";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
          )[];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
    };
  };
  health: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["HealthResponseBody"];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
    };
  };
  getMaterial: {
    parameters: {
      query?: {
        /** @description auto reads saved data or starts synchronization; false reads only; true starts synchronization. */
        sync?: "auto" | "true" | "false";
      };
      header?: never;
      path: {
        materialId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": (
            | {
                data: components["schemas"]["ErrorBody"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "error";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["DataBodyDetail"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "result";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["OperationStatus"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "status";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
          )[];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
    };
  };
  downloadResource: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        materialId: string;
        resourceId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": (
            | {
                data: components["schemas"]["ErrorBody"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "error";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["DataBodyDownloadResult"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "result";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
            | {
                data: components["schemas"]["OperationStatus"];
                /**
                 * @description The event name.
                 * @constant
                 */
                event: "status";
                /** @description The event ID. */
                id?: number;
                /** @description The retry time in milliseconds. */
                retry?: number;
              }
          )[];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
    };
  };
  getSavedFile: {
    parameters: {
      query?: never;
      header?: {
        /** @description Byte range to retrieve. */
        Range?: string;
        /** @description Return 304 if the saved file's ETag matches. */
        "If-None-Match"?: string;
        /** @description Apply Range only if the saved file's ETag matches. */
        "If-Range"?: string;
      };
      path: {
        materialId: string;
        resourceId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          "Accept-Ranges"?: string;
          "Content-Disposition"?: string;
          "Content-Range"?: string;
          ETag?: string;
          [name: string]: unknown;
        };
        content: {
          "application/octet-stream": string;
        };
      };
      /** @description Partial Content */
      206: {
        headers: {
          "Accept-Ranges"?: string;
          "Content-Disposition"?: string;
          "Content-Range"?: string;
          ETag?: string;
          [name: string]: unknown;
        };
        content: {
          "application/octet-stream": string;
        };
      };
      /** @description ETag matched */
      304: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Invalid byte range */
      416: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/plain": string;
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
    };
  };
  headSavedFile: {
    parameters: {
      query?: never;
      header?: {
        /** @description Byte range to retrieve. */
        Range?: string;
        /** @description Return 304 if the saved file's ETag matches. */
        "If-None-Match"?: string;
        /** @description Apply Range only if the saved file's ETag matches. */
        "If-Range"?: string;
      };
      path: {
        materialId: string;
        resourceId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          "Accept-Ranges"?: string;
          "Content-Disposition"?: string;
          "Content-Range"?: string;
          ETag?: string;
          [name: string]: unknown;
        };
        content: {
          "application/octet-stream": string;
        };
      };
      /** @description Partial Content */
      206: {
        headers: {
          "Accept-Ranges"?: string;
          "Content-Disposition"?: string;
          "Content-Range"?: string;
          ETag?: string;
          [name: string]: unknown;
        };
        content: {
          "application/octet-stream": string;
        };
      };
      /** @description ETag matched */
      304: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Invalid byte range */
      416: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/plain": string;
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
    };
  };
  prepareResource: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        materialId: string;
        resourceId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["DataBodyResourcePath"];
        };
      };
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Timeout */
      408: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      /** @description Request Entity Too Large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unsupported Media Type */
      415: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/problem+json": components["schemas"]["ErrorModel"];
        };
      };
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
    };
  };
}
