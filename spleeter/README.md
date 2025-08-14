# Spleeter

An audio source separation tool based on Deezer's Spleeter model, allowing you to split audio files into separate stems.

## Overview

This example uses the same familiar grid interface, but instead of using AI to generate samples for us, we load a music track of our choice and we split the audio based on the model we choose to load the separated stems into the pads. Models you can choose from are:

- 2stems-16kHz: vocals and accompaniment
- 4stems-16kHz: vocals, drums, bass, and other
- 5stems-16kHz: vocals, drums, bass, piano, and other

## Getting Started

### Backend Setup

**Note:** For running on the ITP machine or other jupyterlab environments, it's recommended to import only the backend notebook rather than cloning the entire repository. This keeps your workspace clean and avoids unnecessary files.

1. **Start Jupyter Lab and Open Terminal**
   - After logging into Jupyter Lab, click **File** at the top menu
   - In the dropdown menu, click **New Terminal**
   ![Terminal Menu](../screenshots/terminal.png)

2. **Create Project Directory**
   - In the terminal, create a new directory for your project:
   ```bash
   mkdir spleeter-project
   cd spleeter-project
   ```

3. **Upload the Files**
   - Go back to the Jupyter Lab file browser
   - Navigate to the `spleeter-project` folder you just created in the left sidebar
   - If you don't see your newly created folder, click the refresh button in the toolbar
   ![Refresh Button](../screenshots/refresh.png)
   - Click the **Upload Files** button in the toolbar
   ![Upload Button](../screenshots/upload_files.png)
   - Upload both the `spleeter.ipynb` and `requirements.txt` files from the backend directory of this repository
   - Once uploaded, you'll see them in your project directory

4. **Create Conda Environment**
   - Return to the terminal and create a new conda environment:
   ```bash
   conda create -n spleeter python=3.9
   ```
   - Activate the environment:
   ```bash
   conda activate spleeter
   ```

5. **Install Requirements**
   - Install the required packages:
   ```bash
   pip install -r requirements.txt
   ```

6. **Create Jupyter Kernel**
   - Install ipykernel in your conda environment:
   ```bash
   pip install ipykernel
   ```
   - Register the environment as a Jupyter kernel:
   ```bash
   python -m ipykernel install --user --name spleeter --display-name "Spleeter"
   ```

   **Why this step is needed:** Jupyter needs to know which Python environment to use when running your notebook. By creating a kernel, you're telling Jupyter "use the Python and packages from my conda environment." Without this step, Jupyter would use the default Python installation, which won't have the required packages like spleeter and tensorflow that we just installed.

7. **Open and Configure Notebook**
   - Click on the uploaded `spleeter.ipynb` file in the left sidebar to open it

8. **Select Correct Kernel**
   - In the opened notebook, look for the kernel selector button in the top-right corner
   - Click the button with the circle icon to its right (next to the debug icon)
   ![Kernel Selector](../screenshots/select_kernel_btn.png)
   - In the "Select Kernel" modal, choose "Spleeter" (or whatever name you gave your kernel during setup) from the dropdown
   ![Kernel Modal](../screenshots/select_kernel_modal.png)
   - **Note:** If you don't see your newly created kernel in the dropdown, refresh the page once and try again
   - Click **Select** to confirm

9. **Run the Notebook**
   - You can run cells individually by:
     - Selecting a cell and pressing `Cmd+Enter` (Mac) or `Ctrl+Enter` (Windows/Linux)
     - Or clicking the play button in the toolbar
   - Enter your ngrok auth token when prompted
   - Note the public URL provided by ngrok

### Frontend Setup

You have several options to run the frontend:

**Option 1: Local Server (Recommended)**
1. Open terminal in VS Code:
   - Press `Ctrl+`` (backtick) or `Cmd+`` (Mac)
   - Or go to **Terminal** → **New Terminal** in the top menu
2. Navigate to your project folder, then to the `sketch` directory:
   ```bash
   cd spleeter
   cd sketch
   ```
3. Start a simple Python server:
   ```bash
   python -m http.server 8000
   ```
   **Note:** If `python` doesn't work, try `python3 -m http.server 8000` instead
4. Open your browser and go to `http://localhost:8000`

**Option 2: VS Code Live Server**
1. Install the "Live Server" extension in VS Code
2. Right-click on `sketch/index.html` and select "Open with Live Server"

**Option 3: p5.js Web Editor**
1. Go to [p5.js Web Editor](https://editor.p5js.org/)
2. Create a new project
3. Copy the content from `sketch/index.html` into the HTML section
4. Copy the content from `sketch/sketch.js` into the JavaScript section
5. Create a new file called `spleeter.js` and copy the content from `sketch/spleeter.js`

**After Setup:**
1. Update the `NGROK_URL` variable in `spleeter.js` with your ngrok URL (e.g., `https://abc123.ngrok.io` - trailing slash is optional)
2. Upload an audio file, select a model, and click "Split Audio"
3. After processing, play back individual stems using number keys 1-8