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
    /**
     * Read cached authentication state
     * @description Returns the last observed LMS authentication state without starting an authentication check.
     */
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
    /**
     * Read cached Google authentication state
     * @description Returns the last observed Google authentication state without starting an authentication check.
     */
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
    /**
     * Read saved WebAuthn credential state
     * @description Reports whether a saved virtual WebAuthn credential is registered.
     */
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
    /**
     * Check HTTP process
     * @description Reports HTTP process availability without starting browser work.
     */
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
    /**
     * Serve a saved file
     * @description Serves verified saved content with range requests and ETag conditionals. Does not download missing content.
     */
    get: operations["getSavedFile"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    /**
     * Read saved file headers
     * @description Returns the same headers as a saved-file GET request without a response body.
     */
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
    /**
     * Materialize a saved resource for local clients
     * @description Verifies and materializes saved content and returns its local filesystem path. Does not download missing content.
     */
    post: operations["prepareResource"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/openapi.json": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Read the generated OpenAPI document
     * @description Generated from the same Rust routes and schemas used by this server.
     */
    get: operations["specification"];
    put?: never;
    post?: never;
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
    /** Format: int32 */
    AcademicYear: number;
    Access:
      | {
          /** @enum {string} */
          availability: "available";
          lmsCourseId: components["schemas"]["CourseId"];
        }
      | {
          /** @enum {string} */
          availability: "unavailable";
        };
    Assignment: {
      folderName: string;
      lmsCourseId: components["schemas"]["CourseId"];
      material: components["schemas"]["Material"];
    };
    Assignments: {
      assignments: components["schemas"]["Assignment"][];
      failures: components["schemas"]["CourseFailure"][];
    };
    Authentication:
      | {
          /** @enum {string} */
          status: "unknown";
        }
      | {
          /** @enum {string} */
          status: "authenticated";
        }
      | {
          /** @enum {string} */
          status: "unauthenticated";
        };
    /** @description Set interactive to allow manual authentication in a visible browser on the server machine. */
    AuthenticationInput: {
      /** @default false */
      interactive: boolean;
    };
    /** @enum {string} */
    Availability: "available" | "unavailable";
    /** @enum {string} */
    BoardStatus: "unposted" | "evaluated" | "unknown";
    ContentHash: string;
    Correction:
      | {
          /** @enum {string} */
          correctionMode: "unknown";
        }
      | {
          /** @enum {string} */
          correctionMode: "not-allowed";
        }
      | {
          /** @enum {string} */
          correctionMode: "unlimited";
        }
      | {
          /** Format: int64 */
          correctionLimit: number;
          /** @enum {string} */
          correctionMode: "limited";
        };
    Course: components["schemas"]["Access"] &
      components["schemas"]["Schedule"] & {
        academicYear: components["schemas"]["AcademicYear"];
        archived?: boolean;
        name: string;
      };
    CourseFailure: {
      error: components["schemas"]["Public"];
      lmsCourseId: components["schemas"]["CourseId"];
    };
    CourseId: string;
    CourseMaterials: {
      folders: components["schemas"]["Folder"][];
      lmsCourseId: components["schemas"]["CourseId"];
    };
    Data_Assignments: {
      data: {
        assignments: components["schemas"]["Assignment"][];
        failures: components["schemas"]["CourseFailure"][];
      };
    };
    Data_Authentication: {
      data:
        | {
            /** @enum {string} */
            status: "unknown";
          }
        | {
            /** @enum {string} */
            status: "authenticated";
          }
        | {
            /** @enum {string} */
            status: "unauthenticated";
          };
    };
    Data_CourseMaterials: {
      data: {
        folders: components["schemas"]["Folder"][];
        lmsCourseId: components["schemas"]["CourseId"];
      };
    };
    Data_Detail: {
      data: {
        course: components["schemas"]["Course"];
        material: components["schemas"]["Material"];
        report?: components["schemas"]["Report"] | null;
        resources: components["schemas"]["Resource"][];
      };
    };
    Data_Download: {
      data:
        | {
            downloadUrl: string;
            file: components["schemas"]["SavedFile"];
            /** @enum {string} */
            type: "file";
          }
        | {
            /** @enum {string} */
            type: "external";
            url: components["schemas"]["WebUrl"];
          };
    };
    Data_Registration: {
      data: {
        registered: boolean;
      };
    };
    Data_ResourcePath: {
      data: {
        path: string;
      };
    };
    Data_Vec: {
      data: (components["schemas"]["Access"] &
        components["schemas"]["Schedule"] & {
          academicYear: components["schemas"]["AcademicYear"];
          archived?: boolean;
          name: string;
        })[];
    };
    Deadline:
      | {
          /** Format: date-time */
          publicationDeadlineAt: string;
          /** @enum {string} */
          publicationDeadlineKind: "at";
        }
      | {
          /** @enum {string} */
          publicationDeadlineKind: "unlisted";
        }
      | {
          /** @enum {string} */
          publicationDeadlineKind: "closed";
        }
      | {
          /** @enum {string} */
          publicationDeadlineKind: "unknown";
        };
    Detail: {
      course: components["schemas"]["Course"];
      material: components["schemas"]["Material"];
      report?: components["schemas"]["Report"] | null;
      resources: components["schemas"]["Resource"][];
    };
    /** @enum {string} */
    DocumentStatus: "unviewed" | "viewed" | "partially-viewed" | "unknown";
    Download:
      | {
          downloadUrl: string;
          file: components["schemas"]["SavedFile"];
          /** @enum {string} */
          type: "file";
        }
      | {
          /** @enum {string} */
          type: "external";
          url: components["schemas"]["WebUrl"];
        };
    ErrorBody: {
      error: components["schemas"]["Public"];
    };
    /** @enum {string} */
    FeedbackStatus: "unevaluated" | "evaluated" | "unknown";
    Folder: {
      /** Format: date */
      classDate?: string | null;
      descriptionHtml?: string | null;
      materials: components["schemas"]["Material"][];
      name: string;
    };
    Health: {
      service: string;
      status: string;
    };
    Material: components["schemas"]["MaterialKind"] &
      components["schemas"]["Deadline"] & {
        archived?: boolean;
        lmsMaterialId: components["schemas"]["MaterialId"];
        materialLinkAvailable: boolean;
        name: string;
        /** Format: date-time */
        retrievedAt?: string | null;
      };
    MaterialId: string;
    MaterialKind:
      | {
          resourceAvailability: components["schemas"]["Availability"];
          status: components["schemas"]["DocumentStatus"];
          /** @enum {string} */
          type: "material";
        }
      | {
          status: components["schemas"]["ReportStatus"];
          /** @enum {string} */
          type: "report";
        }
      | {
          status: components["schemas"]["TestStatus"];
          /** @enum {string} */
          type: "test";
        }
      | {
          status: components["schemas"]["QuestionnaireStatus"];
          /** @enum {string} */
          type: "questionnaire";
        }
      | {
          status: components["schemas"]["TestStatus"];
          /** @enum {string} */
          type: "e-learning";
        }
      | {
          status: components["schemas"]["BoardStatus"];
          /** @enum {string} */
          type: "board";
        }
      | {
          status: components["schemas"]["FeedbackStatus"];
          /** @enum {string} */
          type: "feedback";
        }
      | {
          status: components["schemas"]["Unknown"];
          /** @enum {string} */
          type: "unknown";
        };
    /** @enum {string} */
    OperationState: "running" | "succeeded" | "blocked" | "failed";
    OperationStatus: {
      /** Format: int32 */
      attempt: number;
      progress: components["schemas"]["Progress"];
      status: components["schemas"]["OperationState"];
    };
    Progress: {
      completed: number;
      lmsCourseId?: components["schemas"]["CourseId"] | null;
      stage: components["schemas"]["Stage"];
      total: number;
    };
    Public: {
      message: string;
      reason: components["schemas"]["Reason"];
    };
    /** @enum {string} */
    QuestionnaireStatus: "unanswered" | "answered" | "unknown";
    /** @enum {string} */
    Reason:
      | "invalid-input"
      | "payload-too-large"
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
    Registration: {
      registered: boolean;
    };
    Report: components["schemas"]["SubmissionPeriod"] &
      components["schemas"]["Correction"] & {
        fileAnswerAllowed?: boolean | null;
        /** Format: int64 */
        maxTotalFileBytes?: number | null;
        promptHtml?: string | null;
        /** Format: date-time */
        retrievedAt?: string | null;
        status: components["schemas"]["ReportStatus"];
        textAnswerAllowed?: boolean | null;
      };
    /** @enum {string} */
    ReportStatus:
      | "unviewed"
      | "unsubmitted"
      | "submitted"
      | "resubmission-required"
      | "evaluated"
      | "unknown";
    Resource: components["schemas"]["ResourceContent"] & {
      archived?: boolean;
      description?: string | null;
      /** Format: date */
      firstViewedOn?: string | null;
      lmsResourceId: components["schemas"]["ResourceId"];
      name: string;
      /** Format: date */
      registeredOn?: string | null;
      savedFile?: components["schemas"]["SavedFile"] | null;
      status: components["schemas"]["ResourceStatus"];
    };
    ResourceContent:
      | {
          /** @enum {string} */
          type: "file";
          url?: components["schemas"]["WebUrl"] | null;
        }
      | {
          /** @enum {string} */
          type: "external";
          url: components["schemas"]["WebUrl"];
        }
      | {
          /** @enum {string} */
          type: "unknown";
          url?: components["schemas"]["WebUrl"] | null;
        };
    ResourceId: string;
    ResourcePath: {
      path: string;
    };
    /** @enum {string} */
    ResourceStatus: "unviewed" | "viewed" | "unknown";
    SavedFile: {
      contentHash: components["schemas"]["ContentHash"];
      originalFilename: string;
      /** Format: int64 */
      originalSize: number;
    };
    Schedule:
      | {
          /** Format: int32 */
          period: number;
          /** @enum {string} */
          type: "scheduled";
          weekday: components["schemas"]["Weekday"];
        }
      | {
          /** @enum {string} */
          type: "other";
        }
      | {
          /** @enum {string} */
          type: "unknown";
        };
    /** @enum {string} */
    Stage:
      | "waiting"
      | "authenticating"
      | "registering"
      | "fetching-courses"
      | "fetching-materials"
      | "fetching-resources"
      | "downloading"
      | "saving"
      | "completed";
    StreamEvent_Assignments:
      | {
          data: components["schemas"]["OperationStatus"];
          /** @enum {string} */
          event: "status";
        }
      | {
          data: components["schemas"]["Data_Assignments"];
          /** @enum {string} */
          event: "result";
        }
      | {
          data: components["schemas"]["ErrorBody"];
          /** @enum {string} */
          event: "error";
        };
    StreamEvent_Authentication:
      | {
          data: components["schemas"]["OperationStatus"];
          /** @enum {string} */
          event: "status";
        }
      | {
          data: components["schemas"]["Data_Authentication"];
          /** @enum {string} */
          event: "result";
        }
      | {
          data: components["schemas"]["ErrorBody"];
          /** @enum {string} */
          event: "error";
        };
    StreamEvent_CourseMaterials:
      | {
          data: components["schemas"]["OperationStatus"];
          /** @enum {string} */
          event: "status";
        }
      | {
          data: components["schemas"]["Data_CourseMaterials"];
          /** @enum {string} */
          event: "result";
        }
      | {
          data: components["schemas"]["ErrorBody"];
          /** @enum {string} */
          event: "error";
        };
    StreamEvent_Detail:
      | {
          data: components["schemas"]["OperationStatus"];
          /** @enum {string} */
          event: "status";
        }
      | {
          data: components["schemas"]["Data_Detail"];
          /** @enum {string} */
          event: "result";
        }
      | {
          data: components["schemas"]["ErrorBody"];
          /** @enum {string} */
          event: "error";
        };
    StreamEvent_Download:
      | {
          data: components["schemas"]["OperationStatus"];
          /** @enum {string} */
          event: "status";
        }
      | {
          data: components["schemas"]["Data_Download"];
          /** @enum {string} */
          event: "result";
        }
      | {
          data: components["schemas"]["ErrorBody"];
          /** @enum {string} */
          event: "error";
        };
    StreamEvent_Registration:
      | {
          data: components["schemas"]["OperationStatus"];
          /** @enum {string} */
          event: "status";
        }
      | {
          data: components["schemas"]["Data_Registration"];
          /** @enum {string} */
          event: "result";
        }
      | {
          data: components["schemas"]["ErrorBody"];
          /** @enum {string} */
          event: "error";
        };
    StreamEvent_Vec_Course:
      | {
          data: components["schemas"]["OperationStatus"];
          /** @enum {string} */
          event: "status";
        }
      | {
          data: components["schemas"]["Data_Vec"];
          /** @enum {string} */
          event: "result";
        }
      | {
          data: components["schemas"]["ErrorBody"];
          /** @enum {string} */
          event: "error";
        };
    SubmissionPeriod:
      | (components["schemas"]["SubmissionWindow"] & {
          /** @enum {string} */
          submissionPeriodKind: "at";
        })
      | {
          /** @enum {string} */
          submissionPeriodKind: "unlisted";
        }
      | {
          /** @enum {string} */
          submissionPeriodKind: "unknown";
        };
    SubmissionWindow: {
      /** Format: date-time */
      submissionDueAt?: string | null;
      /** Format: date-time */
      submissionStartsAt?: string | null;
    };
    /** @enum {string} */
    TestStatus: "not-started" | "in-progress" | "completed" | "unknown";
    /** @enum {string} */
    Unknown: "unknown";
    /** Format: uri */
    WebUrl: string;
    /** Format: int32 */
    Weekday: number;
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
        sync?: "auto" | "true" | "false";
        /** @description Repeat to select courses; omission uses the courses selected by the synchronization policy. */
        courseId?: components["schemas"]["CourseId"][];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": components["schemas"]["StreamEvent_Assignments"][];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
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
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Data_Authentication"];
        };
      };
      403: {
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
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": components["schemas"]["StreamEvent_Authentication"][];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
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
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Data_Authentication"];
        };
      };
      403: {
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
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": components["schemas"]["StreamEvent_Authentication"][];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
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
        "application/json": components["schemas"]["AuthenticationInput"];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": components["schemas"]["StreamEvent_Authentication"][];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
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
        "application/json": components["schemas"]["AuthenticationInput"];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": components["schemas"]["StreamEvent_Authentication"][];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
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
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Data_Registration"];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
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
        "application/json": components["schemas"]["AuthenticationInput"];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": components["schemas"]["StreamEvent_Registration"][];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
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
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": components["schemas"]["StreamEvent_Registration"][];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
    };
  };
  listCourses: {
    parameters: {
      query?: {
        sync?: "auto" | "true" | "false";
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": components["schemas"]["StreamEvent_Vec_Course"][];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
    };
  };
  listMaterials: {
    parameters: {
      query?: {
        sync?: "auto" | "true" | "false";
      };
      header?: never;
      path: {
        courseId: components["schemas"]["CourseId"];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": components["schemas"]["StreamEvent_CourseMaterials"][];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
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
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Health"];
        };
      };
      403: {
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
        sync?: "auto" | "true" | "false";
      };
      header?: never;
      path: {
        materialId: components["schemas"]["MaterialId"];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": components["schemas"]["StreamEvent_Detail"][];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
    };
  };
  downloadResource: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        materialId: components["schemas"]["MaterialId"];
        resourceId: components["schemas"]["ResourceId"];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": components["schemas"]["StreamEvent_Download"][];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
    };
  };
  getSavedFile: {
    parameters: {
      query?: never;
      header?: {
        /** @description Byte range to retrieve. */
        Range?: string | null;
        /** @description Apply Range only if the saved file's ETag matches. */
        "If-Range"?: string | null;
        /** @description Return 304 if the saved file's ETag matches. */
        "If-None-Match"?: string | null;
      };
      path: {
        materialId: components["schemas"]["MaterialId"];
        resourceId: components["schemas"]["ResourceId"];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/octet-stream": string;
        };
      };
      206: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/octet-stream": string;
        };
      };
      304: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      416: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
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
        Range?: string | null;
        /** @description Apply Range only if the saved file's ETag matches. */
        "If-Range"?: string | null;
        /** @description Return 304 if the saved file's ETag matches. */
        "If-None-Match"?: string | null;
      };
      path: {
        materialId: components["schemas"]["MaterialId"];
        resourceId: components["schemas"]["ResourceId"];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      304: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
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
        materialId: components["schemas"]["MaterialId"];
        resourceId: components["schemas"]["ResourceId"];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["Data_ResourcePath"];
        };
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ErrorBody"];
        };
      };
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
  specification: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": unknown;
        };
      };
      403: {
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
