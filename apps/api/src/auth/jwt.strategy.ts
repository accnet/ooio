import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService, AuthenticatedUser, JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') || 'development-only-change-me',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.tokenType !== 'access') {
      throw new UnauthorizedException('invalid access token');
    }
    const context = await this.auth.contextForUserId(payload.sub);
    if (!context) {
      throw new UnauthorizedException('user no longer exists');
    }
    return context;
  }
}
