import { IsNotEmpty, IsString } from 'class-validator';

export class DeletePushSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;
}
