export type TokenType = 'access' | 'refresh' | 'email-verification' | 'password-reset';

export interface JwtPayload {
  sid?: string;
  jti?: string;
  sub: string; // userId
  email: string;
  type: TokenType;
}
