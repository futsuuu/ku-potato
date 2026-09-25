import type {
    ListCourseMaterials,
    ListCourses,
    ListMaterialResources,
    SyncCourseMaterials,
    SyncCourses,
    SyncMaterialResources,
} from "./in_port.ts";
import { LmsCacheGateway, LmsSourceGateway } from "./out_port.ts";
import type { LmsCourseId, LmsMaterialId } from "ku-potato-domain";
import { Effect } from "effect";

/** Cache-only query. Its environment intentionally excludes `LmsSourceGateway`. */
const listCourses = Effect.gen(function* () {
    const cache = yield* LmsCacheGateway;
    return yield* cache.listCourses;
});

/** Cache-only query. Its environment intentionally excludes `LmsSourceGateway`. */
const listCourseMaterials = Effect.fn("Core.listCourseMaterials")(function* (lmsCourseId: LmsCourseId) {
    const cache = yield* LmsCacheGateway;
    return yield* cache.listCourseMaterials(lmsCourseId);
});

/** Cache-only query. Its environment intentionally excludes `LmsSourceGateway`. */
const listMaterialResources = Effect.fn("Core.listMaterialResources")(function* (lmsMaterialId: LmsMaterialId) {
    const cache = yield* LmsCacheGateway;
    return yield* cache.listMaterialResources(lmsMaterialId);
});

const syncCourses = Effect.gen(function* () {
    const source = yield* LmsSourceGateway;
    const cache = yield* LmsCacheGateway;
    yield* cache.appendCourses(yield* source.refreshCourses);
    return yield* cache.listCourses;
});

const syncCourseMaterials = Effect.fn("Core.syncCourseMaterials")(function* (lmsCourseId: LmsCourseId) {
    const source = yield* LmsSourceGateway;
    const cache = yield* LmsCacheGateway;
    const refresh = yield* source.refreshCourseMaterials(lmsCourseId);
    yield* cache.appendCourseMaterials(refresh);
    return yield* cache.listCourseMaterials(lmsCourseId);
});

const syncMaterialResources = Effect.fn("Core.syncMaterialResources")(function* (lmsMaterialId: LmsMaterialId) {
    const source = yield* LmsSourceGateway;
    const cache = yield* LmsCacheGateway;
    const refresh = yield* source.refreshMaterialResources(lmsMaterialId);
    yield* cache.appendMaterialResources(refresh);
    return yield* cache.listMaterialResources(lmsMaterialId);
});

export function makeListCourses(): ListCourses {
    return { execute: listCourses };
}

export function makeSyncCourses(): SyncCourses {
    return { execute: syncCourses };
}

export function makeListCourseMaterials(): ListCourseMaterials {
    return { execute: listCourseMaterials };
}

export function makeSyncCourseMaterials(): SyncCourseMaterials {
    return { execute: syncCourseMaterials };
}

export function makeListMaterialResources(): ListMaterialResources {
    return { execute: listMaterialResources };
}

export function makeSyncMaterialResources(): SyncMaterialResources {
    return { execute: syncMaterialResources };
}
