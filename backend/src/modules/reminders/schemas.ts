import { z } from 'zod';

export const UnsubscribeRequest = z
  .object({ token: z.string().min(1).max(500).describe('Signed token from the e-mail link') })
  .meta({ id: 'UnsubscribeRequest' });

/** RF19, channel „în aplicație”. */
export const InAppReminder = z
  .object({
    show: z.boolean().describe('True when the reminder time has passed today and reviews are due'),
    due_concept_count: z.int().min(0),
  })
  .meta({ id: 'InAppReminder' });
