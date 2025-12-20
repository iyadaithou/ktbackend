/**
 * Script to check if users exist in Supabase
 * Run with: node scripts/check-users.js
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');

async function checkUsers() {
  try {
    console.log('Checking for users in Supabase...');
    
    // Query all users
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) {
      console.error('Error fetching users:', error);
      return;
    }
    
    if (users.length === 0) {
      console.log('No users found in the database.');
      return;
    }
    
    console.log(`Found ${users.length} users:`);
    users.forEach(user => {
      console.log(`- ${user.id}: ${user.email} (${user.first_name} ${user.last_name}) - Role: ${user.role}, Clerk ID: ${user.clerk_id}`);
    });
    
    // Check for a specific user by email
    if (process.argv[2]) {
      const email = process.argv[2];
      console.log(`\nChecking for user with email: ${email}`);
      
      const { data: specificUser, error: specificError } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single();
      
      if (specificError) {
        console.log(`No user found with email ${email}`);
      } else {
        console.log('User found:', specificUser);
      }
    }
  } catch (error) {
    console.error('Script error:', error);
  }
}

checkUsers(); 