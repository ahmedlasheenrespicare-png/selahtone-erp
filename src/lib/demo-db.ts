// قاعدة بيانات في الذاكرة для وضع المعاينة فقط
// تُستخدم عندما لا تكون قاعدة البيانات الحقيقية متاحة

interface DemoUser {
  id: string;
  email: string;
  fullName: string;
  roleCode: "MANAGER" | "ACCOUNTANT" | "CS_AGENT";
  branchId: string | null;
  branchName: string | null;
  status: "ACTIVE" | "SUSPENDED";
  passwordHash: string;
  mustChangePassword: boolean;
  menuScope: string;
  lastLoginAt: Date | null;
}

// مستخدمو المعاينة المسبَقون
const DEMO_USERS: Record<string, DemoUser> = {
  "manager@selahtone.local": {
    id: "1",
    email: "manager@selahtone.local",
    fullName: "مدير الشركة",
    roleCode: "MANAGER",
    branchId: null,
    branchName: null,
    status: "ACTIVE",
    passwordHash: "$2a$12$IK9hngENYjupBpQY.DL6Zuq4dvSNF55znT6nDxY8xI5ax/26PCtu6", // demo123
    mustChangePassword: false,
    menuScope: "FULL",
    lastLoginAt: null,
  },
  "accountant@selahtone.local": {
    id: "2",
    email: "accountant@selahtone.local",
    fullName: "المحاسب العام",
    roleCode: "ACCOUNTANT",
    branchId: null,
    branchName: null,
    status: "ACTIVE",
    passwordHash: "$2a$12$IK9hngENYjupBpQY.DL6Zuq4dvSNF55znT6nDxY8xI5ax/26PCtu6", // demo123
    mustChangePassword: false,
    menuScope: "FULL",
    lastLoginAt: null,
  },
  "arh@selahtone.local": {
    id: "3",
    email: "arh@selahtone.local",
    fullName: "كاونتر العريش",
    roleCode: "CS_AGENT",
    branchId: "1",
    branchName: "فرع العريش",
    status: "ACTIVE",
    passwordHash: "$2a$12$IK9hngENYjupBpQY.DL6Zuq4dvSNF55znT6nDxY8xI5ax/26PCtu6", // demo123
    mustChangePassword: false,
    menuScope: "LIMITED",
    lastLoginAt: null,
  },
};

export function demoFindUserByEmail(email: string): DemoUser | null {
  return DEMO_USERS[email] || null;
}

export function demoCreateUser(data: Omit<DemoUser, "id">): DemoUser {
  const id = String(Object.keys(DEMO_USERS).length + 1);
  const user = { ...data, id };
  DEMO_USERS[data.email] = user;
  return user;
}

export function demoUpdateUser(email: string, updates: Partial<DemoUser>): DemoUser | null {
  const user = DEMO_USERS[email];
  if (!user) return null;
  Object.assign(user, updates);
  return user;
}
