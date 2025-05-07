import { Module } from '@nestjs/common';
import { SteganographyModule } from './steganography.module';

@Module({
  imports: [SteganographyModule],
})
export class AppModule {}
