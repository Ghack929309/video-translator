import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const registerSchema = z
  .object({
    email: z.string().email("Please enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const videoSubmitSchema = z.object({
  sourceType: z.enum(["UPLOAD", "YOUTUBE", "INSTAGRAM", "FACEBOOK", "VIMEO"]),
  sourceUrl: z.string().url("Please enter a valid URL").optional(),
  storageKey: z.string().min(1).optional(),
  title: z.string().min(1, "Title is required").max(200),
  targetLanguage: z
    .string()
    .min(2, "Please select a target language")
    .max(5),
  ttsEngine: z.enum(["FISH_AUDIO", "COSYVOICE"]),
});

export const updateProfileSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VideoSubmitInput = z.infer<typeof videoSubmitSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
