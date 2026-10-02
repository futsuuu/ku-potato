import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "sqlite",
    schema: "./sqlite/schema.ts",
    out: "./sqlite/drizzle",
});
