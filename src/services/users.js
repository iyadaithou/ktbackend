/**
 * User service - handles user-related business logic
 */
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { ROLES, SUBSCRIPTION_LEVELS } = require('../utils/roles');

/**
 * Create a new user
 * @param {Object} userData - User data
 * @returns {Promise<Object>} Created user
 */
const createUser = async (userData) => {
  try {
    // Hash password if provided
    let hashedPassword = null;
    if (userData.password) {
      hashedPassword = await bcrypt.hash(userData.password, 10);
    }
    
    // Create user in Supabase
    const { data, error } = await supabase
      .from('users')
      .insert({
        email: userData.email,
        password_hash: hashedPassword,
        first_name: userData.firstName,
        last_name: userData.lastName,
        role: userData.role || ROLES.STUDENT, // Default role
        subscription_level: userData.subscriptionLevel || SUBSCRIPTION_LEVELS.FREE,
        subscription_expiry: userData.subscriptionExpiry || null,
        profile_image_url: userData.profileImageUrl || null,
        bio: userData.bio || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // Remove sensitive data
    delete data.password_hash;
    
    return data;
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
};

/**
 * Get a user by ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User object
 */
const getUserById = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, role, subscription_level, subscription_expiry, profile_image_url, bio, created_at, updated_at')
      .eq('id', userId)
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error getting user:', error);
    throw error;
  }
};

/**
 * Get a user by email
 * @param {string} email - User email
 * @returns {Promise<Object>} User object
 */
const getUserByEmail = async (email) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, role, subscription_level, subscription_expiry, profile_image_url, bio, created_at, updated_at')
      .eq('email', email)
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error getting user by email:', error);
    throw error;
  }
};

/**
 * Get users with optional filtering
 * @param {Object} filters - Optional filters
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} Paginated users
 */
const getUsers = async (filters = {}, page = 1, limit = 10) => {
  try {
    let query = supabase
      .from('users')
      .select('id, email, first_name, last_name, role, subscription_level, subscription_expiry, profile_image_url, bio, created_at, updated_at', { count: 'exact' });
    
    // Apply filters
    if (filters.role) {
      query = query.eq('role', filters.role);
    }
    
    if (filters.subscriptionLevel) {
      query = query.eq('subscription_level', filters.subscriptionLevel);
    }
    
    if (filters.search) {
      query = query.or(`first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
    }
    
    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    
    const { data, error, count } = await query
      .range(from, to)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return {
      users: data,
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit)
    };
  } catch (error) {
    console.error('Error getting users:', error);
    throw error;
  }
};

/**
 * Update a user
 * @param {string} userId - User ID
 * @param {Object} userData - Updated user data
 * @returns {Promise<Object>} Updated user
 */
const updateUser = async (userId, userData) => {
  try {
    // Prepare update data
    const updateData = {
      updated_at: new Date().toISOString()
    };
    
    // Add only provided fields
    if (userData.firstName !== undefined) updateData.first_name = userData.firstName;
    if (userData.lastName !== undefined) updateData.last_name = userData.lastName;
    if (userData.email !== undefined) updateData.email = userData.email;
    if (userData.role !== undefined) updateData.role = userData.role;
    if (userData.subscriptionLevel !== undefined) updateData.subscription_level = userData.subscriptionLevel;
    if (userData.subscriptionExpiry !== undefined) updateData.subscription_expiry = userData.subscriptionExpiry;
    if (userData.profileImageUrl !== undefined) updateData.profile_image_url = userData.profileImageUrl;
    if (userData.bio !== undefined) updateData.bio = userData.bio;
    
    // Update password if provided
    if (userData.password) {
      updateData.password_hash = await bcrypt.hash(userData.password, 10);
    }
    
    // Update user
    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select('id, email, first_name, last_name, role, subscription_level, subscription_expiry, profile_image_url, bio, created_at, updated_at')
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
};

/**
 * Update multiple users (bulk operation)
 * @param {Array<string>} userIds - Array of user IDs to update
 * @param {Object} userData - Data to update for all users
 * @returns {Promise<Object>} Result of the bulk update
 */
const bulkUpdateUsers = async (userIds, userData) => {
  try {
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      throw new Error('No user IDs provided for bulk update');
    }

    // Prepare update data
    const updateData = {
      updated_at: new Date().toISOString()
    };
    
    // Add only provided fields
    if (userData.role !== undefined) updateData.role = userData.role;
    if (userData.subscriptionLevel !== undefined) updateData.subscription_level = userData.subscriptionLevel;
    if (userData.subscriptionExpiry !== undefined) updateData.subscription_expiry = userData.subscriptionExpiry;
    
    // Execute bulk update
    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .in('id', userIds)
      .select('id');
    
    if (error) throw error;
    
    return {
      success: true,
      updatedCount: data.length,
      updatedIds: data.map(user => user.id)
    };
  } catch (error) {
    console.error('Error performing bulk user update:', error);
    throw error;
  }
};

/**
 * Delete a user
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} Success status
 */
const deleteUser = async (userId) => {
  try {
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
};

/**
 * Update user subscription
 * @param {string} userId - User ID
 * @param {string} subscriptionLevel - New subscription level
 * @param {string|null} expiryDate - Subscription expiry date (ISO string)
 * @returns {Promise<Object>} Updated user
 */
const updateUserSubscription = async (userId, subscriptionLevel, expiryDate = null) => {
  try {
    if (!Object.values(SUBSCRIPTION_LEVELS).includes(subscriptionLevel)) {
      throw new Error(`Invalid subscription level: ${subscriptionLevel}`);
    }
    
    const updateData = {
      subscription_level: subscriptionLevel,
      subscription_expiry: expiryDate,
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select('id, email, first_name, last_name, role, subscription_level, subscription_expiry, created_at, updated_at')
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating user subscription:', error);
    throw error;
  }
};

/**
 * Authenticate a user and generate a JWT token
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} Authentication result with token
 */
const authenticateUser = async (email, password) => {
  try {
    // Find user by email
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, password_hash, first_name, last_name, role, subscription_level, subscription_expiry')
      .eq('email', email)
      .single();
    
    if (error || !user) {
      throw new Error('Invalid credentials');
    }
    
    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new Error('Invalid credentials');
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role,
        subscriptionLevel: user.subscription_level 
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
    );
    
    // Remove sensitive data
    delete user.password_hash;
    
    return {
      user,
      token,
    };
  } catch (error) {
    console.error('Authentication error:', error);
    throw error;
  }
};

module.exports = {
  createUser,
  getUserById,
  getUserByEmail,
  getUsers,
  updateUser,
  bulkUpdateUsers,
  deleteUser,
  authenticateUser,
  updateUserSubscription,
};
