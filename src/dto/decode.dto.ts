import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class DecodeDto {

  @ApiProperty({
    type: 'string',
    required: true,
    description: 'Password for decryption (min 6 characters)',
     minLength: 6
  })
   @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
} 