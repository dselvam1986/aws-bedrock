import express from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import fileRoutes from './routes/fileRoutes';
import * as dotenv from 'dotenv';

// include env file in config
dotenv.config();

const app = express();
const PORT = 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Define a route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Routes
app.use('/api', fileRoutes);


// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
