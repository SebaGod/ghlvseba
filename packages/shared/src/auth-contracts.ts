import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email();

export const passwordSchema = z.string().min(10).max(128);

export const tokenSchema = z.string().min(20).max(128);

export const registerSchema = z.object({
  companyName: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(80),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({ token: tokenSchema });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const updateMeSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    avatarUrl: z.string().url().optional(),
    currentPassword: z.string().min(1).max(128).optional(),
    newPassword: passwordSchema.optional(),
  })
  .refine((v) => !v.newPassword || !!v.currentPassword, {
    message: 'currentPassword is required to set newPassword',
    path: ['currentPassword'],
  });
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const updateCompanySchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z.string().min(1).max(64).optional(),
  locale: z.string().min(2).max(8).optional(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
