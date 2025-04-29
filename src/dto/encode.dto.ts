import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class EncodeDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    required: true,
    description: 'Image file (PNG recommended)',
  })
  image: any; // Express.Multer.File - Swagger không hiển thị đúng nên dùng any

  @ApiProperty({
    type: 'string',
    required: true,
    description: 'Secret message to hide',
  })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({
    type: 'string',
    required: true,
    description: 'Password for encryption (min 6 characters)',
    minLength: 6
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
} 