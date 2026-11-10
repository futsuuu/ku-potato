# KU-POTATO HTTP API

- **OpenAPI Version:** `3.2.0`
- **API Version:** `0.0.0`

Single-account loopback API. Feature endpoints stream typed results, operation status, and progress using SSE. Replay the feature request to retry.

## Operations

- [GET /assignments](listAssignments.md)
- [GET /auth](getCachedAuthenticationState.md)
- [POST /auth/check](checkAuthentication.md)
- [GET /auth/google](getCachedGoogleAuthenticationState.md)
- [POST /auth/google/check](checkGoogleAuthentication.md)
- [POST /auth/google/login](googleLogin.md)
- [POST /auth/login](login.md)
- [GET /auth/webauthn](getWebAuthn.md)
- [POST /auth/webauthn](registerWebAuthn.md)
- [DELETE /auth/webauthn](deleteWebAuthn.md)
- [GET /courses](listCourses.md)
- [GET /courses/{courseId}/materials](listMaterials.md)
- [GET /healthz](health.md)
- [GET /materials/{materialId}](getMaterial.md)
- [POST /materials/{materialId}/resources/{resourceId}/download](downloadResource.md)
- [GET /materials/{materialId}/resources/{resourceId}/file](getSavedFile.md)
- [HEAD /materials/{materialId}/resources/{resourceId}/file](headSavedFile.md)
- [POST /materials/{materialId}/resources/{resourceId}/prepare](prepareResource.md)

## Schemas

- [Assignment](schemas/Assignment.md)
- [AssignmentsResult](schemas/AssignmentsResult.md)
- [AuthInputBody](schemas/AuthInputBody.md)
- [AuthState](schemas/AuthState.md)
- [Course](schemas/Course.md)
- [CourseFailure](schemas/CourseFailure.md)
- [CourseMaterials](schemas/CourseMaterials.md)
- [DataBodyAssignmentsResult](schemas/DataBodyAssignmentsResult.md)
- [DataBodyAuthState](schemas/DataBodyAuthState.md)
- [DataBodyCourseMaterials](schemas/DataBodyCourseMaterials.md)
- [DataBodyDetail](schemas/DataBodyDetail.md)
- [DataBodyDownloadResult](schemas/DataBodyDownloadResult.md)
- [DataBodyListCourse](schemas/DataBodyListCourse.md)
- [DataBodyRegistrationResult](schemas/DataBodyRegistrationResult.md)
- [DataBodyResourcePath](schemas/DataBodyResourcePath.md)
- [Detail](schemas/Detail.md)
- [Error](schemas/Error.md)
- [ErrorBody](schemas/ErrorBody.md)
- [ErrorDetail](schemas/ErrorDetail.md)
- [ErrorModel](schemas/ErrorModel.md)
- [ExternalDownload](schemas/ExternalDownload.md)
- [FileDownload](schemas/FileDownload.md)
- [Folder](schemas/Folder.md)
- [HealthResponseBody](schemas/HealthResponseBody.md)
- [Material](schemas/Material.md)
- [OperationStatus](schemas/OperationStatus.md)
- [Progress](schemas/Progress.md)
- [RegistrationResult](schemas/RegistrationResult.md)
- [ReportDetail](schemas/ReportDetail.md)
- [Resource](schemas/Resource.md)
- [ResourcePath](schemas/ResourcePath.md)
- [SavedFile](schemas/SavedFile.md)
