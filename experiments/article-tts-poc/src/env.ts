/** Single place the POC reads configuration, mirroring hutch's getEnv convention. */
export const getEnv = (name: string): string | undefined => process.env[name];
