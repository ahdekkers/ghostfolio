import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSyncConnectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountName?: string;

  /**
   * Omit to keep the stored key and only change the account name
   */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  apiSecret?: string;
}
