/**
 * Validation utilities for the application
 */

/**
 * Validates email format
 * @param {string} email - The email to validate
 * @returns {boolean} True if valid, false otherwise
 */
const validateEmail = (email) => {
  if (!email) return false;
  
  // RFC 5322 compliant email regex
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
  return emailRegex.test(email);
};

/**
 * Validates password strength
 * @param {string} password - The password to validate
 * @returns {object} Object with validity and reason
 */
const validatePassword = (password) => {
  if (!password) {
    return { isValid: false, reason: 'Password is required' };
  }
  
  if (password.length < 8) {
    return { isValid: false, reason: 'Password must be at least 8 characters long' };
  }
  
  // Check for at least one number
  if (!/\d/.test(password)) {
    return { isValid: false, reason: 'Password must contain at least one number' };
  }
  
  // Check for at least one lowercase letter
  if (!/[a-z]/.test(password)) {
    return { isValid: false, reason: 'Password must contain at least one lowercase letter' };
  }
  
  // Check for at least one uppercase letter
  if (!/[A-Z]/.test(password)) {
    return { isValid: false, reason: 'Password must contain at least one uppercase letter' };
  }
  
  // Check for at least one special character
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { isValid: false, reason: 'Password must contain at least one special character' };
  }
  
  return { isValid: true };
};

module.exports = {
  validateEmail,
  validatePassword
}; 