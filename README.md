# Smart Traffic Management System

A software engineering project for intelligent urban traffic monitoring and management, combining real-time traffic data, congestion detection, traffic signal optimization, emergency vehicle prioritization, route recommendations, and traffic analytics.

---

## Overview

The **Smart Traffic Management System (STM)** is designed to assist traffic authorities, emergency services, traffic police, and citizens in monitoring and responding to urban traffic conditions.

The system processes traffic-related data to support:

- Traffic monitoring and analytics
- Congestion and incident detection
- Traffic signal optimization
- Emergency vehicle prioritization
- Alternate route recommendations
- Traffic alerts and notifications
- Historical traffic analysis

The project is designed with a modular architecture so that additional AI and IoT-based components can be integrated as the system evolves.

---

## Features

### Traffic Management

- Monitor traffic conditions and measurements
- Manage traffic locations and signals
- Detect and manage congestion events
- Track traffic incidents and alerts
- Analyze historical traffic data

### Intelligent Traffic Control

- Dynamic traffic signal optimization
- Traffic-density-based signal decisions
- Emergency vehicle prioritization
- Green-corridor support for emergency vehicles

### Route Management

- Alternate route recommendations
- Route management and analysis
- Traffic-aware route decisions

### Alerts & Analytics

- Traffic alerts and notifications
- Congestion and incident alerts
- Traffic analytics
- Report generation
- Historical traffic data management

### User Roles

The system supports role-based functionality for different stakeholders.

| Role | Responsibilities |
|------|------------------|
| **Admin** | Manage system-level resources, traffic signals, analytics and reports |
| **Traffic Authority** | Monitor traffic, manage congestion and optimize signals |
| **Traffic Police** | Monitor traffic and receive alerts |
| **Emergency Service** | Request emergency priority and create green corridors |
| **Citizen** | Report incidents, receive alerts and access route recommendations |

---

## System Workflow

```text
┌─────────────────────────┐
│    Traffic Data Sources │
│ Sensors / GPS / CCTV    │
│ Citizen Reports         │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│    Traffic Monitoring   │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Traffic Data Analysis │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Congestion / Incident   │
│       Detection         │
└──────┬─────────┬────────┘
       │         │
       │         └─────────────────┐
       ▼                           ▼
┌───────────────┐          ┌──────────────────┐
│ Signal        │          │ Emergency        │
│ Optimization  │          │ Prioritization   │
└───────┬───────┘          └────────┬─────────┘
        │                           │
        ▼                           ▼
 Traffic Signals             Green Corridor
        │
        └──────────────┬───────────────┐
                       │               │
                       ▼               ▼
              Route Recommendation   Alerts
                       │
                       ▼
                 Dashboards &
                   Analytics
```

---

## Architecture

The project follows a modular application architecture:

```text
STM
│
├── frontend/
│   └── Web-based user interface
│
├── backend/
│   ├── Controllers
│   ├── Routes
│   ├── Models
│   ├── Services
│   ├── Middleware
│   └── Database Configuration
│
├── ai-service/
│   └── AI/ML components
│
└── simulator/
    └── Traffic simulation components
```

> **Note:** `ai-service` and `simulator` are currently reserved for further development and are not yet part of the tracked implementation.

---

## Technology Stack

### Frontend

- React
- Vite
- JavaScript
- HTML5
- CSS3

### Backend

- Node.js
- Express.js
- JavaScript
- REST APIs

### Database

- MySQL

### Development Tools

- Git
- GitHub
- Visual Studio Code
- npm

---

## Backend Modules

The backend is organized into separate controllers, routes, models, and services.

### Controllers

The system currently contains controllers for:

- Authentication
- Congestion Events
- Emergency Priority
- Emergency Vehicles
- Monitoring Devices
- Routes
- Route Recommendations
- Signal Optimization
- Traffic Alerts
- Traffic Analytics
- Traffic Locations
- Traffic Measurements
- Traffic Signals

### Services

Core business logic is separated into services for:

- Congestion detection
- Emergency priority
- Route recommendation
- Signal optimization
- Traffic alerts
- Traffic analytics

This separation allows the application to remain modular and easier to maintain as additional functionality is introduced.

---

## Project Structure

```text
STM/
│
├── backend/
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── services/
│   ├── package.json
│   └── server.js
│
├── frontend/
│   ├── public/
│   ├── src/
│   ├── package.json
│   └── vite.config.js
│
├── ai-service/
│
├── simulator/
│
├── .gitignore
└── README.md
```

---

## Getting Started

### Prerequisites

Make sure the following are installed:

- Node.js
- npm
- MySQL
- Git

### Clone the Repository

```bash
git clone https://github.com/twhdd/STM.git
cd STM
```

### Backend Setup

```bash
cd backend
npm install
```

Configure the database connection and required environment variables before starting the backend.

Then run:

```bash
npm start
```

### Frontend Setup

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend will then be available through the local Vite development server.

---

## Database

The backend uses **MySQL** for persistent storage.

The database contains entities for areas such as:

- Users
- Traffic Signals
- Traffic Locations
- Traffic Measurements
- Traffic Alerts
- Traffic Incidents
- Emergency Vehicles
- Monitoring Devices
- Routes
- Congestion Events

Database configuration is maintained in:

```text
backend/config/database.js
```

---

## Future Development

Planned extensions include:

- AI-based traffic prediction
- Computer-vision-based incident detection
- IoT sensor integration
- Traffic simulation
- Advanced predictive analytics
- Real-time map visualization
- More sophisticated route optimization
- Integration with external traffic data sources

---

## Project Status

**Status:** Active Development

The current implementation focuses on the core frontend and backend architecture, traffic management modules, APIs, database integration, and intelligent traffic-management services.

AI and simulation components are planned for subsequent development.

---

## Contributors

Developed as part of a Software Engineering project.

---

## License

This project is currently intended for academic and educational purposes.
