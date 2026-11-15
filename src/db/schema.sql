CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  phone VARCHAR(20) NULL,
  photo VARCHAR(255) NULL,
  role_name VARCHAR(100) NULL,
  category VARCHAR(30) NULL,
  data_scope VARCHAR(10) NOT NULL DEFAULT 'all',
  permissions TEXT NULL,
  is_super TINYINT(1) NOT NULL DEFAULT 1,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receptionists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  admin_id INT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS durations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  days INT NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  category_id INT NULL,
  fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  duration_id INT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (duration_id) REFERENCES durations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inquiries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  inquiry_no VARCHAR(30) NOT NULL UNIQUE,
  student_name VARCHAR(150) NOT NULL,
  photo VARCHAR(255) NULL,
  email VARCHAR(150),
  phone VARCHAR(20) NOT NULL,
  gender ENUM('Male','Female','Other') NULL,
  address TEXT,
  state VARCHAR(100),
  city VARCHAR(100),
  zip_code VARCHAR(10),
  receptionist_id INT NULL,
  course_id INT NULL,
  source ENUM('Google','Youtube','Facebook','Instagram','Friend/Referral','Other') NULL,
  inquiry_date DATE NOT NULL,
  status ENUM('Pending','Contacted') NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (receptionist_id) REFERENCES receptionists(id) ON DELETE SET NULL,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
  created_by INT NULL
);

CREATE TABLE IF NOT EXISTS admissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admission_no VARCHAR(30) NOT NULL UNIQUE,
  student_name VARCHAR(150) NOT NULL,
  photo VARCHAR(255),
  father_name VARCHAR(150),
  email VARCHAR(150),
  phone VARCHAR(20) NOT NULL,
  gender ENUM('Male','Female','Other') NULL,
  dob DATE NULL,
  address TEXT,
  state VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  zip_code VARCHAR(10),
  identity_proof ENUM('Aadhar Card','PAN Card','Driving License','Voter ID','Passport') NULL,
  identity_number VARCHAR(50) NULL,
  receptionist_id INT NULL,
  course_id INT NULL,
  form_fees DECIMAL(12,2) NOT NULL DEFAULT 0,
  admission_date DATE NOT NULL,
  special_offer TINYINT(1) NOT NULL DEFAULT 0,
  special_offer_text VARCHAR(255) NULL,
  status ENUM('Pending','Confirmed') NOT NULL DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (receptionist_id) REFERENCES receptionists(id) ON DELETE SET NULL,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
  created_by INT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_code VARCHAR(20) NOT NULL UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100),
  email VARCHAR(150),
  phone VARCHAR(20),
  dob DATE NULL,
  admission_date DATE NULL,
  address TEXT,
  course_id INT NULL,
  duration_id INT NULL,
  course_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_type ENUM('fixed','percentage') NOT NULL DEFAULT 'fixed',
  discount_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  photo VARCHAR(255),
  password_hash VARCHAR(255) NULL,
  portal_menus TEXT NULL,
  token_version INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL,
  FOREIGN KEY (duration_id) REFERENCES durations(id) ON DELETE SET NULL,
  created_by INT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(30) NOT NULL UNIQUE,
  student_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  method ENUM('UPI','Net Banking','Card','Cash','Other') NOT NULL,
  transaction_id VARCHAR(100),
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  created_by INT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  refund_date DATE NOT NULL,
  method ENUM('UPI','Net Banking','Card','Cash','Other') NOT NULL,
  transaction_id VARCHAR(100),
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  created_by INT NULL
);

CREATE TABLE IF NOT EXISTS study_materials (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  duration_id INT NOT NULL,
  topic VARCHAR(200) NOT NULL,
  material_type ENUM('PDF Document','Image','Text Content') NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  file_path VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (duration_id) REFERENCES durations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(100) PRIMARY KEY,
  `value` TEXT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS certificates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  code VARCHAR(100) NOT NULL UNIQUE,
  file_path VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);
