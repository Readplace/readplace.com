import { z } from "zod";

export const OAuthClientIdSchema = z.string().brand<"OAuthClientId">();
export type OAuthClientId = z.infer<typeof OAuthClientIdSchema>;

export const AccessTokenSchema = z.string().brand<"AccessToken">();
export type AccessToken = z.infer<typeof AccessTokenSchema>;

export const RefreshTokenSchema = z.string().brand<"RefreshToken">();
export type RefreshToken = z.infer<typeof RefreshTokenSchema>;

export const AuthorizationCodeSchema = z.string().brand<"AuthorizationCode">();
export type AuthorizationCode = z.infer<typeof AuthorizationCodeSchema>;
