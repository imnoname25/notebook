import packageJson from "../../package.json";

export const APP_VERSION = process.env.NOTEBOOK_VERSION?.trim() || packageJson.version;
export const APP_REVISION = process.env.NOTEBOOK_GIT_SHA?.trim() || null;
