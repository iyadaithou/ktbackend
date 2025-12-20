# Task Management System - API Routes

## Overview

This document explains the new task management API routes that have been added to the system. These routes are **separate from the existing application submission/review system** and focus specifically on **task assignment and management within the application process**.

## Route Structure

### 1. `/api/tasks` - Individual Task Management
**Purpose**: Handle CRUD operations for individual tasks assigned to users.

**Key Endpoints**:
- `GET /api/tasks` - Get user's tasks with filters
- `POST /api/tasks` - Create new task
- `GET /api/tasks/:id` - Get specific task
- `PUT /api/tasks/:id` - Update task
- `PATCH /api/tasks/:id/complete` - Mark task as completed
- `DELETE /api/tasks/:id` - Delete task
- `GET /api/tasks/stats/overview` - Get task statistics

### 2. `/api/application-tasks` - Application Task Management
**Purpose**: Handle task assignment and management within the application process.

**Key Endpoints**:
- `GET /api/application-tasks/school/:schoolId` - Get applications for a school (admin/school manager only)
- `GET /api/application-tasks/my-applications` - Get user's applications
- `GET /api/application-tasks/:id` - Get specific application with tasks
- `POST /api/application-tasks` - Create new application
- `PATCH /api/application-tasks/:id/status` - Update application status
- `POST /api/application-tasks/:id/assign-tasks` - Assign tasks to applicants
- `GET /api/application-tasks/stats/school/:schoolId` - Get application statistics

### 3. `/api/task-templates` - Task Template Management
**Purpose**: Handle reusable task templates for quick task assignment.

**Key Endpoints**:
- `GET /api/task-templates` - Get all task templates
- `GET /api/task-templates/:id` - Get specific template
- `POST /api/task-templates` - Create new template (admin/school manager only)
- `PUT /api/task-templates/:id` - Update template (admin/school manager only)
- `DELETE /api/task-templates/:id` - Delete template (admin/school manager only)
- `GET /api/task-templates/category/:task_type` - Get templates by category
- `GET /api/task-templates/stats/overview` - Get template statistics

### 4. `/api/notifications` - Notification Management
**Purpose**: Handle notifications for task assignments and updates.

**Key Endpoints**:
- `GET /api/notifications` - Get user notifications
- `GET /api/notifications/unread-count` - Get unread notification count
- `PATCH /api/notifications/:id/read` - Mark notification as read
- `PATCH /api/notifications/mark-all-read` - Mark all notifications as read
- `DELETE /api/notifications/:id` - Delete notification
- `GET /api/notifications/stats/overview` - Get notification statistics
- `POST /api/notifications` - Create notification (internal use)

## How It Works

### Application Flow:
1. **Student applies to school** (existing system)
2. **School receives application** (existing system)
3. **School assigns tasks to applicant** (NEW - `/api/application-tasks`)
4. **Student completes assigned tasks** (NEW - `/api/tasks`)
5. **School tracks progress** (NEW - `/api/application-tasks`)

### Task Assignment Process:
1. School manager views applications via `/api/application-tasks/school/:schoolId`
2. School manager selects task templates via `/api/task-templates`
3. School manager assigns tasks via `/api/application-tasks/:id/assign-tasks`
4. Student receives notifications via `/api/notifications`
5. Student completes tasks via `/api/tasks`

## Key Features

### Task Types:
- **school_assigned**: Tasks assigned by schools to applicants
- **pythagoras_assigned**: Tasks assigned by Pythagoras admins
- **self_assigned**: Tasks created by students themselves

### Priority System:
- School/Pythagoras assigned tasks have higher priority
- Dashboard notifications prioritize school-assigned tasks
- Self-assigned tasks are lower priority

### Notification Types:
- `task_assigned`: New task assigned
- `task_due_soon`: Task due soon
- `task_overdue`: Task is overdue
- `task_completed`: Task completed
- `application_updated`: Application status updated
- `document_required`: Document submission required
- `interview_scheduled`: Interview scheduled

## Database Integration

The routes work with the following database tables:
- `applications` - Student applications
- `tasks` - Individual tasks
- `application_tasks` - Application-task relationships
- `task_templates` - Reusable task templates
- `task_notifications` - Notification system
- `application_progress` - Progress tracking

## Security & Authorization

- All routes require authentication (`authenticateToken`)
- Admin/school manager routes require authorization (`authorize`)
- Users can only access their own tasks and applications
- School managers can only access applications for their school

## Error Handling

All routes include comprehensive error handling:
- Input validation
- Database error handling
- Authorization checks
- Proper HTTP status codes
- Detailed error messages

## Next Steps

These routes provide the foundation for the task management system. The next phase will involve creating the frontend UI components to interact with these APIs.
