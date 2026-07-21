import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AuthenticatedRequest } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateOrganizationInput, OrgsService } from './orgs.service';

class CreateOrganizationBody implements CreateOrganizationInput {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  slug?: string;
}

@Controller('orgs')
@UseGuards(JwtAuthGuard)
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.orgs.list(request.user);
  }

  @Post()
  create(@Body() body: CreateOrganizationBody, @Req() request: AuthenticatedRequest) {
    return this.orgs.create(body, request.user);
  }
}
