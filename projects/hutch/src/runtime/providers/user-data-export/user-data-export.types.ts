import type { UserId } from "@packages/domain/user";

export interface UploadUserDataExportParams {
	userId: UserId;
	body: string;
}

export interface UploadUserDataExportResult {
	s3Key: string;
	downloadUrl: string;
}

export type UploadUserDataExport = (
	params: UploadUserDataExportParams,
) => Promise<UploadUserDataExportResult>;

export type DeleteUserExports = (userId: UserId) => Promise<void>;
