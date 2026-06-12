import { Global, Module } from '@nestjs/common';

import { ApicenterService } from './apicenter.service';

@Global()
@Module({
  providers: [ApicenterService],
  exports: [ApicenterService],
})
export class ApicenterModule {}
