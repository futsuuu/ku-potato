/** Values shared by the application's inbound and outbound contracts. */

import type { CourseMaterialsSnapshot, LmsCourseId } from "../domain/mod.ts";

/** Whether browser UI may be shown while authenticating. */
export type HeadPolicy = "auto" | "true" | "false";

/** Result of checking the locally stored LMS authentication state. */
export type LmsAuthenticationStatus = "authenticated" | "unauthenticated";

/** A kind binds one input type to one successful output type. */
export interface JobDefinition {
    readonly kind: string;
    readonly input: unknown;
    readonly output: unknown;
}

export interface CourseMaterialsJobDefinition extends JobDefinition {
    readonly kind: "fetch-course-materials";
    readonly input: { readonly lmsCourseId: LmsCourseId; readonly head: HeadPolicy };
    readonly output: CourseMaterialsSnapshot;
}

export type ApplicationJobDefinition = CourseMaterialsJobDefinition;
export type JobRequest<D extends JobDefinition> = D extends JobDefinition
    ? { readonly kind: D["kind"]; readonly input: D["input"] }
    : never;

/** Scheduling and ownership are independent of the operation's input and result. */
export type Job<D extends JobDefinition = ApplicationJobDefinition> = D extends JobDefinition ? {
        readonly id: number;
        readonly kind: D["kind"];
        readonly input: D["input"];
        readonly status: "queued" | "running" | "succeeded" | "failed" | "blocked";
        readonly attempts: number;
        readonly maxAttempts: number;
        readonly ownerId?: string;
        readonly leaseToken?: string;
        readonly leaseUntil?: number;
        readonly lastError?: string;
        readonly errorTag?: string;
    }
    : never;

export type JobCompletion<D extends JobDefinition> = D extends JobDefinition
    ? { readonly job: Job<D>; readonly output: D["output"] }
    : never;

export interface JobFailure {
    readonly message: string;
    readonly tag: string;
    readonly retry: boolean;
    readonly blocked: boolean;
}
