import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class DecodeDto {
  // Thuộc tính 'image' được xử lý bởi FileInterceptor và @UploadedFile(), không cần trong DTO body.
  // @ApiProperty({
  //   type: 'string',
  //   format: 'binary',
  //   required: true,
  //   description: 'Stego image file (PNG recommended)',
  // })
  // image: any;

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