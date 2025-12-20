/**
 * User controllers - handle user-related HTTP requests
 */
const userService = require('../services/users');
const { PERMISSIONS } = require('../utils/roles');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { validateEmail, validatePassword } = require('../utils/validation');

/**
 * Register a new user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const registerUser = async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, role = 'student', subscriptionLevel = 'free', subscriptionExpiry } = req.body;

    // Validate inputs
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ 
        error: 'Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, and one number' 
      });
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user into database
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase(),
        password_hash: passwordHash,
        first_name: firstName,
        last_name: lastName,
        role,
        subscription_level: subscriptionLevel,
        subscription_expiry: subscriptionExpiry || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating user:', error);
      return res.status(500).json({ error: 'Failed to create user' });
    }

    // Generate JWT token
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not configured');
      return res.status(500).json({ error: 'Server configuration error: Authentication not properly configured' });
    }
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.first_name,
        lastName: newUser.last_name,
        role: newUser.role,
        subscriptionLevel: newUser.subscription_level,
        subscriptionExpiry: newUser.subscription_expiry,
      },
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Login a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Email and password are required'
      });
    }
    
    // Fetch user from database
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not configured');
      return res.status(500).json({ error: 'Server configuration error: Authentication not properly configured' });
    }
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        subscriptionLevel: user.subscription_level,
        subscriptionExpiry: user.subscription_expiry,
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get current user profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getCurrentUser = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching user:', error);
      return res.status(500).json({ error: 'Failed to fetch user data' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        subscriptionLevel: user.subscription_level,
        subscriptionExpiry: user.subscription_expiry,
        profileImageUrl: user.profile_image_url,
        bio: user.bio,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      }
    });
  } catch (error) {
    console.error('Error fetching current user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get a user by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getUserById = async (req, res, next) => {
  try {
    const userId = req.params.id;
    
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching user:', error);
      return res.status(500).json({ error: 'Failed to fetch user data' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        subscriptionLevel: user.subscription_level,
        subscriptionExpiry: user.subscription_expiry,
        profileImageUrl: user.profile_image_url,
        bio: user.bio,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      }
    });
  } catch (error) {
    console.error('Error fetching user by ID:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get user by Clerk ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getUserByClerkId = async (req, res, next) => {
  try {
    const { clerkId } = req.params;
    
    console.log('Looking up user by Clerk ID:', clerkId);
    
    if (!clerkId) {
      return res.status(400).json({ error: 'Clerk ID is required' });
    }
    
    // First log all users with admin role for debugging
    const { data: adminUsers, error: adminError } = await supabase
      .from('users')
      .select('id, email, role, clerk_id')
      .eq('role', 'admin');
      
    if (!adminError) {
      console.log('Current admin users in database:', JSON.stringify(adminUsers, null, 2));
    }
    
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('clerk_id', clerkId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching user by Clerk ID:', error);
      return res.status(500).json({ error: 'Failed to fetch user data' });
    }

    if (!user) {
      console.log('User not found with clerk_id, attempting auto-provision:', clerkId);
      try {
        // Lazy init Clerk client like middleware
        const secret = process.env.CLERK_SECRET_KEY;
        if (!secret) {
          return res.status(404).json({ error: 'User not found' });
        }
        const mod = await import('@clerk/clerk-sdk-node');
        const createClerkClient = mod.createClerkClient || mod.default?.createClerkClient || mod.createClient || null;
        if (!createClerkClient) {
          return res.status(404).json({ error: 'User not found' });
        }
        const clerkClient = createClerkClient({ secretKey: secret });
        const clerkUser = await clerkClient.users.getUser(clerkId);
        const emailToUse = clerkUser?.primaryEmailAddress?.emailAddress || clerkUser?.emailAddresses?.[0]?.emailAddress || null;
        if (!emailToUse) {
          return res.status(404).json({ error: 'User not found' });
        }
        const { data: created, error: createErr } = await supabase
          .from('users')
          .insert({
            email: String(emailToUse).toLowerCase(),
            clerk_id: clerkId,
            role: 'student',
            subscription_level: 'free'
          })
          .select('*')
          .single();
        if (createErr || !created) {
          // Handle duplicate email: link Clerk ID to existing user
          if (createErr?.code === '23505') {
            try {
              const { data: existing } = await supabase
                .from('users')
                .select('*')
                .eq('email', String(emailToUse).toLowerCase())
                .maybeSingle();
              if (existing?.id) {
                const { data: updated, error: updErr } = await supabase
                  .from('users')
                  .update({ clerk_id: clerkId })
                  .eq('id', existing.id)
                  .select('*')
                  .single();
                if (!updErr && updated) {
                  return res.json({
                    user: {
                      id: updated.id,
                      email: updated.email,
                      firstName: updated.first_name,
                      lastName: updated.last_name,
                      role: updated.role,
                      subscriptionLevel: updated.subscription_level,
                      subscriptionExpiry: updated.subscription_expiry,
                      clerkId: updated.clerk_id,
                      createdAt: updated.created_at,
                    }
                  });
                }
              }
            } catch (linkErr) {
              console.warn('Linking Clerk ID to existing user failed:', linkErr?.message || linkErr);
            }
          }
          console.error('Auto-provision via controller failed:', createErr);
          return res.status(404).json({ error: 'User not found' });
        }
        return res.json({
          user: {
            id: created.id,
            email: created.email,
            firstName: created.first_name,
            lastName: created.last_name,
            role: created.role,
            subscriptionLevel: created.subscription_level,
            subscriptionExpiry: created.subscription_expiry,
            clerkId: created.clerk_id,
            createdAt: created.created_at,
          }
        });
      } catch (provErr) {
        console.warn('Auto-provision attempt failed:', provErr?.message || provErr);
        return res.status(404).json({ error: 'User not found' });
      }
    }

    console.log('User found:', JSON.stringify({
      id: user.id,
      email: user.email,
      role: user.role,
      clerk_id: user.clerk_id
    }, null, 2));

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        subscriptionLevel: user.subscription_level,
        subscriptionExpiry: user.subscription_expiry,
        clerkId: user.clerk_id,
        createdAt: user.created_at,
      }
    });
  } catch (error) {
    console.error('Error fetching user by Clerk ID:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get all users
 */
const getAllUsers = async (req, res) => {
  try {
    const { role, search, subscriptionLevel, page = 1, limit = 10 } = req.query;
    
    // Build query
    let query = supabase.from('users').select('*', { count: 'exact' });
    
    // Apply filters
    if (role && role !== 'all') {
      query = query.eq('role', role);
    }
    
    if (subscriptionLevel && subscriptionLevel !== 'all') {
      query = query.eq('subscription_level', subscriptionLevel);
    }
    
    if (search) {
      query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
    }
    
    // Apply ordering and pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query
      .order('created_at', { ascending: false })
      .range(from, to);
    
    // Execute query
    const { data: users, error, count } = await query;

    if (error) {
      console.error('Error fetching users:', error);
      return res.status(500).json({ error: 'Failed to fetch users' });
    }

    // Fetch custom roles for these users
    const userIds = users.map(u => u.id);
    let userCustomRolesMap = new Map();
    if (userIds.length) {
      const { data: userRoles } = await supabase
        .from('user_custom_roles')
        .select('user_id, role_id, custom_roles:custom_roles(id, name, description)')
        .in('user_id', userIds);
      (userRoles || []).forEach(r => {
        const arr = userCustomRolesMap.get(r.user_id) || [];
        arr.push({ id: r.custom_roles?.id || r.role_id, name: r.custom_roles?.name || 'role', description: r.custom_roles?.description || null });
        userCustomRolesMap.set(r.user_id, arr);
      });
    }

    res.json({
      users: users.map(user => ({
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        customRoles: userCustomRolesMap.get(user.id) || [],
        subscriptionLevel: user.subscription_level,
        subscriptionExpiry: user.subscription_expiry,
        profileImageUrl: user.profile_image_url,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      })),
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / limit)
    });
  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = id || req.user.userId;
    const { firstName, lastName, email, role, password, profileImageUrl, bio, subscriptionLevel, subscriptionExpiry } = req.body;
    
    // Prepare update object
    const updateData = {};
    
    if (firstName !== undefined) updateData.first_name = firstName;
    if (lastName !== undefined) updateData.last_name = lastName;
    if (email !== undefined) {
      if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      updateData.email = email.toLowerCase();
    }
    if (role !== undefined) updateData.role = role;
    if (profileImageUrl !== undefined) updateData.profile_image_url = profileImageUrl;
    if (bio !== undefined) updateData.bio = bio;
    if (subscriptionLevel !== undefined) updateData.subscription_level = subscriptionLevel;
    if (subscriptionExpiry !== undefined) updateData.subscription_expiry = subscriptionExpiry;
    
    // Handle password update separately with hashing
    if (password) {
      if (!validatePassword(password)) {
        return res.status(400).json({ 
          error: 'Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, and one number' 
        });
      }
      const salt = await bcrypt.genSalt(10);
      updateData.password_hash = await bcrypt.hash(password, salt);
    }
    
    // Update user in database
    const { data: updatedUser, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating user:', error);
      return res.status(500).json({ error: 'Failed to update user' });
    }

    res.json({
      message: 'User updated successfully',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        role: updatedUser.role,
        subscriptionLevel: updatedUser.subscription_level,
        subscriptionExpiry: updatedUser.subscription_expiry,
        profileImageUrl: updatedUser.profile_image_url,
        bio: updatedUser.bio,
        updatedAt: updatedUser.updated_at,
      }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const deleteUser = async (req, res, next) => {
  try {
    const userId = req.params.id;
    
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      console.error('Error deleting user:', error);
      return res.status(500).json({ error: 'Failed to delete user' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update user subscription
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const updateUserSubscription = async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { subscriptionLevel, subscriptionExpiry } = req.body;
    
    // Validate inputs
    if (!subscriptionLevel) {
      return res.status(400).json({ error: 'Subscription level is required' });
    }
    
    // Update user subscription in database
    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({
        subscription_level: subscriptionLevel,
        subscription_expiry: subscriptionExpiry || null,
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating user subscription:', error);
      return res.status(500).json({ error: 'Failed to update user subscription' });
    }

    res.json({
      message: 'User subscription updated successfully',
      user: {
        id: updatedUser.id,
        subscriptionLevel: updatedUser.subscription_level,
        subscriptionExpiry: updatedUser.subscription_expiry,
        updatedAt: updatedUser.updated_at,
      }
    });
  } catch (error) {
    console.error('Error updating user subscription:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Bulk update users
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const bulkUpdateUsers = async (req, res, next) => {
  try {
    const { userIds, data } = req.body;
    
    // Validate inputs
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'User IDs array is required' });
    }
    
    if (!data || Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Update data is required' });
    }
    
    // Prepare update object
    const updateData = {};
    
    if (data.role) updateData.role = data.role;
    if (data.subscriptionLevel) updateData.subscription_level = data.subscriptionLevel;
    if (data.subscriptionExpiry) updateData.subscription_expiry = data.subscriptionExpiry;
    
    // Update users in database
    const { data: updatedUsers, error } = await supabase
      .from('users')
      .update(updateData)
      .in('id', userIds)
      .select('id, role, subscription_level, subscription_expiry, updated_at');

    if (error) {
      console.error('Error bulk updating users:', error);
      return res.status(500).json({ error: 'Failed to update users' });
    }

    res.json({
      message: `${updatedUsers.length} users updated successfully`,
      users: updatedUsers.map(user => ({
        id: user.id,
        role: user.role,
        subscriptionLevel: user.subscription_level,
        subscriptionExpiry: user.subscription_expiry,
        updatedAt: user.updated_at,
      }))
    });
  } catch (error) {
    console.error('Error bulk updating users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get subscription statistics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getSubscriptionStats = async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('subscription_settings')
      .select('*');

    if (error) {
      console.error('Error fetching subscription stats:', error);
      return res.status(500).json({ error: 'Failed to fetch subscription statistics' });
    }

    res.json(data.map(stat => ({
      subscriptionLevel: stat.subscription_level,
      userCount: stat.user_count,
      expiredCount: stat.expired_count,
      activeCount: stat.active_count
    })));
  } catch (error) {
    console.error('Error fetching subscription stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getCurrentUser,
  getUserById,
  getUserByClerkId,
  getAllUsers,
  updateUser,
  deleteUser,
  updateUserSubscription,
  bulkUpdateUsers,
  getSubscriptionStats
};
