import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService, LoginInput, RegisterInput } from './auth.service';
import { Public } from './public.decorator';

class RegisterBody implements RegisterInput {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  organizationName?: string;
}

class LoginBody implements LoginInput {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

class RefreshBody {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() body: RegisterBody) {
    return this.auth.register(body);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginBody) {
    return this.auth.login(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: RefreshBody) {
    return this.auth.refresh(body.refreshToken);
  }
}
