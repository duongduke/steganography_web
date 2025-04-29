import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class DecodeDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    required: true,
    description: 'Stego image file (PNG recommended)',
  })
  image: any; // Express.Multer.File

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