import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard, Roles } from '../auth/rbac.guard';
import { ApiKeysService, CreateApiKeyInput } from './api-keys.service';

class CreateApiKeyBody implements CreateApiKeyInput {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];
}

@Controller('orgs/:id/api-keys')
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('owner', 'admin')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post()
  create(@Param('id') organizationId: string, @Body() body: CreateApiKeyBody) {
    return this.apiKeys.create(organizationId, body);
  }

  @Delete(':keyId')
  revoke(@Param('id') organizationId: string, @Param('keyId') keyId: string) {
    return this.apiKeys.revoke(organizationId, keyId);
  }
}
