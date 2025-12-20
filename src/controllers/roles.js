/**
 * Role controllers - handle role management HTTP requests
 */
const supabase = require('../config/supabase');
const { ROLES, PERMISSIONS, hasPermission, getAllRoles, getAllPermissions } = require('../utils/roles');

/**
 * Utility: normalize a provided identifier (Clerk ID or UUID) to a Supabase user UUID
 * Returns the user row with at least { id } or null if not found
 */
async function resolveSupabaseUserByAnyId(anyId) {
  if (!anyId) return null;
  // First, try direct match on primary UUID id
  try {
    const byId = await supabase
      .from('users')
      .select('id')
      .eq('id', anyId)
      .single();
    if (!byId.error && byId.data) return byId.data;
  } catch (_) {}
  // Fallback: try Clerk ID mapping
  try {
    const byClerk = await supabase
      .from('users')
      .select('id')
      .eq('clerk_id', anyId)
      .single();
    if (!byClerk.error && byClerk.data) return byClerk.data;
  } catch (_) {}
  return null;
}

/**
 * Get all available system roles
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getSystemRoles = async (req, res, next) => {
  try {
    const roles = getAllRoles();
    
    res.json({
      status: 'success',
      data: {
        roles: Object.entries(roles).map(([key, value]) => ({
          key,
          value
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching system roles:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to fetch system roles' 
    });
  }
};

/**
 * Get all available permissions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getPermissions = async (req, res, next) => {
  try {
    const permissions = getAllPermissions();
    
    res.json({
      status: 'success',
      data: {
        permissions: Object.entries(permissions).map(([key, value]) => ({
          key,
          value
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to fetch permissions' 
    });
  }
};

/**
 * Get permissions for a specific role
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getRolePermissions = async (req, res, next) => {
  try {
    const { role } = req.params;
    
    if (!role || !Object.values(ROLES).includes(role)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid role specified'
      });
    }
    
    // Get the role's permissions
    const rolePermissions = Object.entries(PERMISSIONS)
      .filter(([_, permission]) => hasPermission(role, permission))
      .map(([key, value]) => ({ key, value }));
    
    res.json({
      status: 'success',
      data: {
        role,
        permissions: rolePermissions
      }
    });
  } catch (error) {
    console.error('Error fetching role permissions:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to fetch role permissions' 
    });
  }
};

/**
 * Get all custom roles
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getCustomRoles = async (req, res, next) => {
  try {
    const { data: customRoles, error } = await supabase
      .from('custom_roles')
      .select('*')
      .order('name');
    
    if (error) {
      throw error;
    }
    
    res.json({
      status: 'success',
      data: {
        roles: customRoles
      }
    });
  } catch (error) {
    console.error('Error fetching custom roles:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to fetch custom roles' 
    });
  }
};

/**
 * Create a custom role
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const createCustomRole = async (req, res, next) => {
  try {
    const { name, description, permissions } = req.body;
    
    if (!name) {
      return res.status(400).json({
        status: 'error',
        message: 'Role name is required'
      });
    }
    
    if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'At least one permission is required'
      });
    }
    
    // Validate that all permissions exist
    const allPermissions = Object.values(PERMISSIONS);
    const invalidPermissions = permissions.filter(p => !allPermissions.includes(p));
    
    if (invalidPermissions.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid permissions: ${invalidPermissions.join(', ')}`
      });
    }
    
    // Create the custom role
    const { data: newRole, error } = await supabase
      .from('custom_roles')
      .insert({
        name,
        description: description || null,
        permissions,
        created_by: req.user.id
      })
      .select()
      .single();
    
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          status: 'error',
          message: 'A custom role with this name already exists'
        });
      }
      // Enhance diagnostics
      console.error('Create custom role failed:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      throw error;
    }
    
    res.status(201).json({
      status: 'success',
      data: {
        role: newRole
      }
    });
  } catch (error) {
    console.error('Error creating custom role:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to create custom role' 
    });
  }
};

/**
 * Update a custom role
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const updateCustomRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, permissions } = req.body;
    
    if (!id) {
      return res.status(400).json({
        status: 'error',
        message: 'Role ID is required'
      });
    }
    
    // Check if role exists
    const { data: existingRole, error: fetchError } = await supabase
      .from('custom_roles')
      .select('id')
      .eq('id', id)
      .single();
    
    if (fetchError || !existingRole) {
      return res.status(404).json({
        status: 'error',
        message: 'Custom role not found'
      });
    }
    
    // Prepare update data
    const updates = {};
    
    if (name) updates.name = name;
    if (description !== undefined) updates.description = description;
    
    if (permissions) {
      if (!Array.isArray(permissions) || permissions.length === 0) {
        return res.status(400).json({
          status: 'error',
          message: 'At least one permission is required'
        });
      }
      
      // Validate that all permissions exist
      const allPermissions = Object.values(PERMISSIONS);
      const invalidPermissions = permissions.filter(p => !allPermissions.includes(p));
      
      if (invalidPermissions.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: `Invalid permissions: ${invalidPermissions.join(', ')}`
        });
      }
      
      updates.permissions = permissions;
    }
    
    // Update the role
    const { data: updatedRole, error } = await supabase
      .from('custom_roles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          status: 'error',
          message: 'A custom role with this name already exists'
        });
      }
      throw error;
    }
    
    res.json({
      status: 'success',
      data: {
        role: updatedRole
      }
    });
  } catch (error) {
    console.error('Error updating custom role:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to update custom role' 
    });
  }
};

/**
 * Delete a custom role
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const deleteCustomRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        status: 'error',
        message: 'Role ID is required'
      });
    }
    
    // Check if role is being used
    const { data: userRoles, error: userRolesError } = await supabase
      .from('user_custom_roles')
      .select('user_id')
      .eq('role_id', id);
    
    if (userRolesError) {
      throw userRolesError;
    }
    
    if (userRoles && userRoles.length > 0) {
      return res.status(409).json({
        status: 'error',
        message: 'Cannot delete role as it is currently assigned to users',
        data: {
          assignedUsersCount: userRoles.length
        }
      });
    }
    
    // Delete the role
    const { error } = await supabase
      .from('custom_roles')
      .delete()
      .eq('id', id);
    
    if (error) {
      throw error;
    }
    
    res.json({
      status: 'success',
      message: 'Custom role deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting custom role:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to delete custom role' 
    });
  }
};

/**
 * Assign a custom role to a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const assignCustomRoleToUser = async (req, res, next) => {
  try {
    const { userId, roleId } = req.body;
    
    if (!userId || !roleId) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID and Role ID are required'
      });
    }
    
    // Resolve user (accepts Supabase UUID or Clerk ID)
    const user = await resolveSupabaseUserByAnyId(userId);
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }
    
    // Check if role exists
    const { data: role, error: roleError } = await supabase
      .from('custom_roles')
      .select('id')
      .eq('id', roleId)
      .single();
    
    if (roleError || !role) {
      return res.status(404).json({
        status: 'error',
        message: 'Custom role not found'
      });
    }
    
    // Assign role to user
    const { error } = await supabase
      .from('user_custom_roles')
      .upsert({
        user_id: user.id,
        role_id: roleId,
        assigned_at: new Date().toISOString()
      });
    
    if (error) {
      throw error;
    }
    
    res.json({
      status: 'success',
      message: 'Role assigned to user successfully'
    });
  } catch (error) {
    console.error('Error assigning role to user:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to assign role to user' 
    });
  }
};

/**
 * Remove a custom role from a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const removeCustomRoleFromUser = async (req, res, next) => {
  try {
    const { userId, roleId } = req.params;
    
    if (!userId || !roleId) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID and Role ID are required'
      });
    }
    
    // Remove role from user
    const { error } = await supabase
      .from('user_custom_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role_id', roleId);
    
    if (error) {
      throw error;
    }
    
    res.json({
      status: 'success',
      message: 'Role removed from user successfully'
    });
  } catch (error) {
    console.error('Error removing role from user:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to remove role from user' 
    });
  }
};

/**
 * Get all custom roles assigned to a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const getUserCustomRoles = async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        status: 'error',
        message: 'User ID is required'
      });
    }
    
    // Get all custom roles assigned to user (accept Supabase UUID or Clerk ID)
    const resolved = await resolveSupabaseUserByAnyId(userId);
    if (!resolved) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }
    // Fetch link rows then hydrate roles without relying on FK join
    const { data: linkRows, error: linkErr } = await supabase
      .from('user_custom_roles')
      .select('role_id, assigned_at')
      .eq('user_id', resolved.id);
    if (linkErr) throw linkErr;
    const roleIds = Array.from(new Set((linkRows || []).map(r => r.role_id).filter(Boolean)));
    let rolesById = new Map();
    if (roleIds.length > 0) {
      const { data: roleRows, error: roleErr } = await supabase
        .from('custom_roles')
        .select('id, name, description, permissions')
        .in('id', roleIds);
      if (roleErr) throw roleErr;
      (roleRows || []).forEach(r => rolesById.set(r.id, r));
    }
    res.json({
      status: 'success',
      data: {
        roles: (linkRows || []).map(ur => ({
          id: ur.role_id,
          assignedAt: ur.assigned_at,
          ...(rolesById.get(ur.role_id) || {})
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching user custom roles:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to fetch user custom roles' 
    });
  }
};

module.exports = {
  getSystemRoles,
  getPermissions,
  getRolePermissions,
  getCustomRoles,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  assignCustomRoleToUser,
  removeCustomRoleFromUser,
  getUserCustomRoles
}; 