
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const listButton = document.getElementById("listButton");
const generateButton = document.getElementById("generateButton");

let uploadedFiles = [];

const displayFiles = (files) => {
  fileList.innerHTML = ''; // Clear previous files
  uploadedFiles = []; // Reset the file list

  for (const file of files) {
    uploadedFiles.push(file.name);
    const fileItem = document.createElement("p");
    fileItem.textContent = `File: ${file.name}`;
    fileList.appendChild(fileItem);
  }
};

const uploadFiles = async (files) => {
  for (const file of files) {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await response.text();
      console.log(data);
      // alert(`Uploaded: ${file.name}`);
    } catch (error) {
      console.error('Error uploading file:', error);
      alert(`Failed to upload: ${file.name}`);
    }
  }
};

dropZone.addEventListener("click", () => {
  fileInput.click();
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragover");
  const files = event.dataTransfer.files;
  if (files.length > 0) {
    displayFiles(files);
    uploadFiles(files);
  }
});

fileInput.addEventListener("change", () => {
  const files = fileInput.files;
  if (files.length > 0) {
    displayFiles(files);
    uploadFiles(files);
  }
});

listButton.addEventListener("click", () => {
  listButton.disabled = true;
  getFlows();
});

const getFlows = async () => {

  try {
    const response = await fetch('/api/list-flow', {
      method: 'GET'
    });
    const data = await response.text();
    console.log(data);
    listButton.disabled = false;
    // alert(`Uploaded: ${file.name}`);
  } catch (error) {
    listButton.disabled = false;
    console.error('Error uploading file:', error);
    alert(`Failed to upload: ${file.name}`);
  }
};

generateButton.addEventListener("click", async () => {
  if (uploadedFiles.length === 0) {
    alert("No files available to process.");
    return;
  }

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: uploadedFiles })
    });

    const data = await response.json();
    console.log("Generated Output:", data);
    alert("Generated output successfully!");
  } catch (error) {
    console.error("Error generating output:", error);
    alert("Failed to generate output.");
  }
});