/**
 * Role definitions and permissions for the application
 */

// Define roles
const ROLES = {
  // Admin role
  ADMIN: 'admin',
  
  // LMS roles
  TUTOR: 'tutor',
  COURSE_MANAGER: 'course_manager',
  STUDENT: 'student',
  
  // Common App roles
  INSTITUTION_ADMIN: 'institution_admin',
  ACCOUNT_MANAGER: 'account_manager',
  SCHOOL_PROFILE: 'school_profile',
  
  // New Platform roles
  AGENT: 'agent',
  SALES: 'sales',
  ENROLLMENT_COORDINATOR: 'enrollment_coordinator',
  
  // Other roles
  EMPLOYEE: 'employee',
  AMBASSADOR: 'ambassador',
};

// Define permissions
const PERMISSIONS = {
  // User management
  CREATE_USER: 'create:user',
  READ_USER: 'read:user',
  READ_ALL_USERS: 'read:all:users', 
  UPDATE_USER: 'update:user',
  DELETE_USER: 'delete:user',
  BULK_UPDATE_USERS: 'bulk:update:users',
  MANAGE_ROLES: 'manage:roles',
  
  // Course management
  CREATE_COURSE: 'create:course',
  READ_COURSE: 'read:course',
  UPDATE_COURSE: 'update:course',
  DELETE_COURSE: 'delete:course',
  ENROLL_COURSE: 'enroll:course',
  
  // Content management
  CREATE_CONTENT: 'create:content',
  READ_CONTENT: 'read:content',
  UPDATE_CONTENT: 'update:content',
  DELETE_CONTENT: 'delete:content',
  
  // Institution management
  MANAGE_INSTITUTION: 'manage:institution',
  VIEW_INSTITUTION: 'view:institution',
  
  // School profile management
  MANAGE_SCHOOL_PROFILE: 'manage:school:profile',
  VIEW_SCHOOL_PROFILE: 'view:school:profile',
  
  // Subscription management
  UPDATE_SUBSCRIPTION: 'update:subscription',
  READ_SUBSCRIPTION_STATS: 'read:subscription:stats',

  // Ambassador program management
  MANAGE_AMBASSADORS: 'manage_ambassadors',
  
  // AI administration
  MANAGE_AI: 'manage:ai',

  // Support/Ticketing
  READ_SUPPORT_TICKETS: 'read:support:tickets',
  MANAGE_SUPPORT_TICKETS: 'manage:support:tickets',
  SEND_SUPPORT_EMAIL: 'send:support:email',

  // Agent-specific permissions
  MANAGE_AGENT_STUDENTS: 'manage:agent:students',
  CREATE_AGENT_STUDENT: 'create:agent:student',
  SUBMIT_FOR_AGENT_STUDENT: 'submit:for:agent:student',
  
  // Sales-specific permissions
  VIEW_ASSIGNED_STUDENTS: 'view:assigned:students',
  SUBMIT_FOR_STUDENT: 'submit:for:student',
  MANAGE_STUDENT_ASSIGNMENTS: 'manage:student:assignments',
  
  // Enrollment Coordinator permissions
  VIEW_SUPERVISED_USERS: 'view:supervised:users',
  MANAGE_SUPERVISED_APPLICATIONS: 'manage:supervised:applications',
  ASSIGN_TASKS_TO_STUDENTS: 'assign:tasks:to:students',
  UPDATE_APPLICATION_STATUS: 'update:application:status',
  
  // School Staff permissions
  MANAGE_SCHOOL_FORMS: 'manage:school:forms',
  BROWSE_STUDENT_POOL: 'browse:student:pool',
  SEND_DIRECT_OFFERS: 'send:direct:offers',
  EXPORT_APPLICATIONS: 'export:applications',
  REVIEW_APPLICATIONS: 'review:applications',
  
  // Student permissions
  SUBMIT_OWN_APPLICATION: 'submit:own:application',
  VIEW_OWN_APPLICATIONS: 'view:own:applications',
  OPT_INTO_POOL: 'opt:into:pool',
  VIEW_DIRECT_OFFERS: 'view:direct:offers',
  RESPOND_TO_OFFERS: 'respond:to:offers',
  
  // School search and export
  SEARCH_SCHOOLS: 'search:schools',
  EXPORT_SCHOOL_LIST_PDF: 'export:school:list:pdf',
  
  // Supervisor management
  MANAGE_SUPERVISORS: 'manage:supervisors',
  VIEW_SUPERVISORS: 'view:supervisors',

  // Messaging
  SEND_SMS: 'send:sms',
};

// Define role permissions
const ROLE_PERMISSIONS = {
  // Admin has all permissions
  [ROLES.ADMIN]: Object.values(PERMISSIONS),
  
  // LMS roles
  [ROLES.COURSE_MANAGER]: [
    PERMISSIONS.READ_USER,
    PERMISSIONS.CREATE_COURSE,
    PERMISSIONS.READ_COURSE,
    PERMISSIONS.UPDATE_COURSE,
    PERMISSIONS.DELETE_COURSE,
    PERMISSIONS.CREATE_CONTENT,
    PERMISSIONS.READ_CONTENT,
    PERMISSIONS.UPDATE_CONTENT,
    PERMISSIONS.DELETE_CONTENT,
  ],
  
  [ROLES.TUTOR]: [
    PERMISSIONS.READ_USER,
    PERMISSIONS.READ_COURSE,
    PERMISSIONS.CREATE_CONTENT,
    PERMISSIONS.READ_CONTENT,
    PERMISSIONS.UPDATE_CONTENT,
  ],
  
  [ROLES.STUDENT]: [
    PERMISSIONS.READ_COURSE,
    PERMISSIONS.READ_CONTENT,
    PERMISSIONS.ENROLL_COURSE,
    PERMISSIONS.SUBMIT_OWN_APPLICATION,
    PERMISSIONS.VIEW_OWN_APPLICATIONS,
    PERMISSIONS.OPT_INTO_POOL,
    PERMISSIONS.VIEW_DIRECT_OFFERS,
    PERMISSIONS.RESPOND_TO_OFFERS,
    PERMISSIONS.SEARCH_SCHOOLS,
    PERMISSIONS.VIEW_SCHOOL_PROFILE,
  ],
  
  // Common App roles
  [ROLES.INSTITUTION_ADMIN]: [
    PERMISSIONS.READ_USER,
    PERMISSIONS.MANAGE_INSTITUTION,
    PERMISSIONS.MANAGE_SCHOOL_PROFILE,
    PERMISSIONS.VIEW_INSTITUTION,
    PERMISSIONS.VIEW_SCHOOL_PROFILE,
    PERMISSIONS.MANAGE_SCHOOL_FORMS,
    PERMISSIONS.BROWSE_STUDENT_POOL,
    PERMISSIONS.SEND_DIRECT_OFFERS,
    PERMISSIONS.EXPORT_APPLICATIONS,
    PERMISSIONS.REVIEW_APPLICATIONS,
    PERMISSIONS.ASSIGN_TASKS_TO_STUDENTS,
    PERMISSIONS.UPDATE_APPLICATION_STATUS,
  ],
  
  [ROLES.ACCOUNT_MANAGER]: [
    PERMISSIONS.READ_USER,
    PERMISSIONS.VIEW_INSTITUTION,
    PERMISSIONS.MANAGE_SCHOOL_PROFILE,
    PERMISSIONS.VIEW_SCHOOL_PROFILE,
    PERMISSIONS.REVIEW_APPLICATIONS,
    PERMISSIONS.EXPORT_APPLICATIONS,
  ],
  
  [ROLES.SCHOOL_PROFILE]: [
    PERMISSIONS.VIEW_SCHOOL_PROFILE,
    PERMISSIONS.REVIEW_APPLICATIONS,
  ],
  
  // Agent role - manages guest students without accounts
  [ROLES.AGENT]: [
    PERMISSIONS.READ_USER,
    PERMISSIONS.MANAGE_AGENT_STUDENTS,
    PERMISSIONS.CREATE_AGENT_STUDENT,
    PERMISSIONS.SUBMIT_FOR_AGENT_STUDENT,
    PERMISSIONS.SEARCH_SCHOOLS,
    PERMISSIONS.VIEW_SCHOOL_PROFILE,
    PERMISSIONS.EXPORT_SCHOOL_LIST_PDF,
    PERMISSIONS.VIEW_OWN_APPLICATIONS,
    PERMISSIONS.SEND_SMS,
  ],
  
  // Sales role - works with assigned students who have accounts
  [ROLES.SALES]: [
    PERMISSIONS.READ_USER,
    PERMISSIONS.VIEW_ASSIGNED_STUDENTS,
    PERMISSIONS.SUBMIT_FOR_STUDENT,
    PERMISSIONS.SEARCH_SCHOOLS,
    PERMISSIONS.VIEW_SCHOOL_PROFILE,
    PERMISSIONS.EXPORT_SCHOOL_LIST_PDF,
    PERMISSIONS.VIEW_OWN_APPLICATIONS,
    PERMISSIONS.SEND_SMS,
  ],
  
  // Enrollment Coordinator - supervises agents/sales
  [ROLES.ENROLLMENT_COORDINATOR]: [
    PERMISSIONS.READ_USER,
    PERMISSIONS.VIEW_SUPERVISED_USERS,
    PERMISSIONS.MANAGE_SUPERVISED_APPLICATIONS,
    PERMISSIONS.ASSIGN_TASKS_TO_STUDENTS,
    PERMISSIONS.UPDATE_APPLICATION_STATUS,
    PERMISSIONS.VIEW_SCHOOL_PROFILE,
    PERMISSIONS.VIEW_SUPERVISORS,
    PERMISSIONS.SEND_SMS,
  ],
  
  // Employee role permissions
  [ROLES.EMPLOYEE]: [
    PERMISSIONS.READ_USER,
    PERMISSIONS.READ_COURSE,
    PERMISSIONS.READ_CONTENT,
    PERMISSIONS.VIEW_INSTITUTION,
    PERMISSIONS.VIEW_SCHOOL_PROFILE,
    PERMISSIONS.MANAGE_AMBASSADORS,
    PERMISSIONS.MANAGE_AI,
    PERMISSIONS.READ_SUPPORT_TICKETS,
    PERMISSIONS.MANAGE_SUPPORT_TICKETS,
    PERMISSIONS.SEND_SUPPORT_EMAIL,
    PERMISSIONS.SEARCH_SCHOOLS,
  ],
  
  // Ambassador role
  [ROLES.AMBASSADOR]: [
    PERMISSIONS.READ_COURSE,
    PERMISSIONS.READ_CONTENT,
    PERMISSIONS.VIEW_SCHOOL_PROFILE,
    PERMISSIONS.SEARCH_SCHOOLS,
  ],
};

/**
 * Check if a role has a specific permission
 * @param {string} role - The role to check
 * @param {string} permission - The permission to check for
 * @returns {boolean} - Whether the role has the permission
 */
const hasPermission = (role, permission) => {
  if (!ROLE_PERMISSIONS[role]) {
    return false;
  }
  
  return ROLE_PERMISSIONS[role].includes(permission);
};

/**
 * Get all permissions for a role
 * @param {string} role - The role to get permissions for
 * @returns {string[]} - Array of permissions
 */
const getPermissionsForRole = (role) => {
  return ROLE_PERMISSIONS[role] || [];
};

/**
 * Get all available roles
 * @returns {Object} - Object containing all role keys and values
 */
const getAllRoles = () => {
  return ROLES;
};

/**
 * Get all available permissions
 * @returns {Object} - Object containing all permission keys and values
 */
const getAllPermissions = () => {
  return PERMISSIONS;
};

/**
 * Check if a role can supervise other users
 * @param {string} role - The role to check
 * @returns {boolean} - Whether the role can supervise
 */
const canSupervise = (role) => {
  return [ROLES.ADMIN, ROLES.ENROLLMENT_COORDINATOR].includes(role);
};

/**
 * Check if a role can submit applications on behalf of others
 * @param {string} role - The role to check
 * @returns {boolean} - Whether the role can submit for others
 */
const canSubmitForOthers = (role) => {
  return [ROLES.ADMIN, ROLES.AGENT, ROLES.SALES].includes(role);
};

/**
 * Check if a role is a school staff role
 * @param {string} role - The role to check
 * @returns {boolean} - Whether the role is school staff
 */
const isSchoolStaff = (role) => {
  return [ROLES.INSTITUTION_ADMIN, ROLES.ACCOUNT_MANAGER, ROLES.SCHOOL_PROFILE].includes(role);
};

// Subscription levels
const SUBSCRIPTION_LEVELS = {
  FREE: 'free',
  BASIC: 'basic',
  PREMIUM: 'premium',
  ENTERPRISE: 'enterprise'
};

module.exports = {
  ROLES,
  PERMISSIONS,
  SUBSCRIPTION_LEVELS,
  hasPermission,
  getPermissionsForRole,
  getAllRoles,
  getAllPermissions,
  canSupervise,
  canSubmitForOthers,
  isSchoolStaff,
};
