import { z } from "zod";

export const addressSchema = z.string().trim().toLowerCase().email("メールアドレスを入力してください。").max(254);
export const displayNameSchema = z.string().trim().min(1, "表示名を入力してください。").max(80, "表示名は80文字以下にしてください。");
export const initialPasswordSchema = z.string().min(8, "初期パスワードは8文字以上にしてください。").max(128, "パスワードは128文字以下にしてください。");
export const passwordSchema = z.string().min(12, "新しいパスワードは12文字以上にしてください。").max(128, "パスワードは128文字以下にしてください。").refine((password) => password !== "password", "既定の初期パスワードは使用できません。");

export const loginSchema = z.object({ address: addressSchema, password: z.string().min(1) });
export const createUserSchema = z.object({ address: addressSchema, displayName: z.union([displayNameSchema, z.literal("")]).optional(), password: initialPasswordSchema, isAdmin: z.boolean().default(false) });
export const updateUserSchema = z.object({ address: addressSchema, displayName: displayNameSchema, isAdmin: z.boolean() });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1, "現在のパスワードを入力してください。"), newPassword: passwordSchema }).refine(({ currentPassword, newPassword }) => currentPassword !== newPassword, { message: "新しいパスワードは現在のパスワードと変えてください。", path: ["newPassword"] });
export const deleteUserSchema = z.object({ address: addressSchema });
