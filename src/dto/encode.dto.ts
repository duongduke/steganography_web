import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength, IsOptional, IsIn } from 'class-validator';

export class EncodeDto { 

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

  @ApiProperty({
    type: 'string',
    required: false,
    description: 'Output image format (PNG, BMP, TIFF, RAW)',
    default: 'png',
    enum: ['png', 'bmp', 'tiff', 'raw']
  })
  @IsString()
  @IsOptional()
  @IsIn(['png', 'bmp', 'tiff', 'raw'])
  outputFormat?: string;

  @ApiProperty({
    type: 'string',
    required: false,
    description: 'Custom filename for output image (without extension)',
  })
  @IsString()
  @IsOptional()
  outputFilename?: string;
} 