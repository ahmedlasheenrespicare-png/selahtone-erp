/** نرفض أيضًا قيمة المثال القديمة المنشورة؛ الطول وحده لا يجعلها سرًا. */
export function isValidAuthSecret(value: string | undefined): value is string {
  return Boolean(value && value.length >= 32 && value !== "ضع-هنا-قيمة-عشوائية-طويلة-48-بايت");
}
