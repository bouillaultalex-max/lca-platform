import { IsUUID } from 'class-validator';

export class GetBatchInputDto {
  @IsUUID()
  batchId!: string;
}
