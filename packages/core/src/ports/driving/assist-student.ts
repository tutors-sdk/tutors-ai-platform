import type { AssistanceRequest, AssistanceResponse } from '../../domain/assistance.ts';

/** Driving port: answer a grounded question within policy. */
export interface AssistStudent {
  assist(request: AssistanceRequest): Promise<AssistanceResponse>;
}
