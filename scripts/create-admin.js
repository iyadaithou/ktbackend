/**
 * Create Admin User Script
 * 
 * This script creates an admin user in Supabase for an existing Clerk user.
 * Run this script with: node scripts/create-admin.js <clerk_user_id> <email> <first_name> <last_name>
 */
require('dotenv').config();
const { supabase } = require('../src/config/supabase');

async function createAdminUser() {
  // Get command line arguments
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node scripts/create-admin.js <clerk_user_id> <email> [first_name] [last_name]');
    process.exit(1);
  }
  
  const [clerkId, email, firstName = '', lastName = ''] = args;
  
  try {
    // Check if user already exists with this clerk_id
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, role')
      .eq('clerk_id', clerkId)
      .single();
    
    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error checking for existing user:', checkError);
      process.exit(1);
    }
    
    if (existingUser) {
      console.log(`User with clerk_id ${clerkId} already exists with id ${existingUser.id} and role ${existingUser.role}`);
      
      // Update to admin if not already
      if (existingUser.role !== 'admin') {
        const { data: updatedUser, error: updateError } = await supabase
          .from('users')
          .update({ role: 'admin' })
          .eq('id', existingUser.id)
          .select()
          .single();
        
        if (updateError) {
          console.error('Error updating user role:', updateError);
          process.exit(1);
        }
        
        console.log(`Updated user role to admin for user ${updatedUser.id}`);
      }
      
      process.exit(0);
    }
    
    // Create new admin user
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase(),
        first_name: firstName,
        last_name: lastName,
        clerk_id: clerkId,
        role: 'admin',
        subscription_level: 'premium',
        subscription_expiry: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString(), // 1 year from now
      })
      .select()
      .single();
    
    if (insertError) {
      console.error('Error creating admin user:', insertError);
      process.exit(1);
    }
    
    console.log(`Created admin user with id ${newUser.id} for clerk_id ${clerkId}`);
    process.exit(0);
  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

createAdminUser(); 