import { z } from "zod";

export const CollaboratorSchema = z.object({
  login: z.string().min(1),
  avatar_url: z.string().url().nullable(),
  name: z.string().nullable(),
});

export type Collaborator = z.infer<typeof CollaboratorSchema>;
