
let sourceImage = null;
let inkLayers = [];
let separatedImages = [];
let converted = false;
let busy = false;

const MAX_PREVIEW_SIZE = 700;
const MAX_PROCESS_PIXELS = 1400000;

let canvas;
let statusElement;

// ------------------------------------------
// SETUP
// ------------------------------------------

function setup() {
  pixelDensity(1);

  canvas = createCanvas(700, 500);
  canvas.parent("canvas-container");

  statusElement = document.getElementById("status");

  populateInkMenus();
  updateInkCount();

  background(245);
  fill(80);
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(18);
  text("Upload an image to begin", width / 2, height / 2);

  noLoop();

  document.getElementById("upload")
    .addEventListener("change", handleUpload);

  document.getElementById("inkCount")
    .addEventListener("change", () => {
      updateInkCount();
      invalidateConversion();
    });

  document.getElementById("convert")
    .addEventListener("click", convertImage);

  document.getElementById("export")
    .addEventListener("click", exportLayers);

  document.getElementById("contrast")
    .addEventListener("input", (event) => {
      document.getElementById("contrastValue").textContent =
        event.target.value + "%";

      invalidateConversion();
    });

  document.getElementById("method")
    .addEventListener("change", invalidateConversion);

  document.getElementById("quality")
    .addEventListener("change", invalidateConversion);
}

// ------------------------------------------
// INK COLOR MENUS
// ------------------------------------------

function populateInkMenus() {
  const menus = [
    document.getElementById("ink1"),
    document.getElementById("ink2"),
    document.getElementById("ink3")
  ];

  RISOCOLORS.forEach((ink) => {
    menus.forEach((menu) => {
      const option = document.createElement("option");

      option.value = ink.name;
      option.textContent = ink.name;

      menu.appendChild(option);
    });
  });

  menus[0].value = "BLUE";
  menus[1].value = "FLUORESCENTPINK";
  menus[2].value = "YELLOW";

  menus.forEach((menu, index) => {
    menu.addEventListener("change", () => {
      updateSwatch(index + 1);
      invalidateConversion();
    });

    updateSwatch(index + 1);
  });
}

function updateSwatch(index) {
  const name = document.getElementById("ink" + index).value;

  const ink = RISOCOLORS.find((color) => color.name === name);

  if (!ink) return;

  document.getElementById("swatch" + index).style.backgroundColor =
    `rgb(${ink.color.join(",")})`;
}

// ------------------------------------------
// TWO / THREE COLOR SWITCH
// ------------------------------------------

function updateInkCount() {
  const count = Number(
    document.getElementById("inkCount").value
  );

  const showThird = count === 3;

  document.getElementById("ink3Label").style.display =
    showThird ? "" : "none";

  document.getElementById("ink3Container").style.display =
    showThird ? "flex" : "none";
}

function invalidateConversion() {
  converted = false;
  document.getElementById("export").disabled = true;
}

// ------------------------------------------
// IMAGE UPLOAD
// ------------------------------------------

function setStatus(message) {
  statusElement.textContent = message;
}

function handleUpload(event) {
  const file = event.target.files[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    setStatus("Please select an image file.");
    return;
  }

  const url = URL.createObjectURL(file);

  loadImage(
    url,
    (img) => {
      URL.revokeObjectURL(url);

      sourceImage = img;
      inkLayers = [];
      separatedImages = [];

      invalidateConversion();
      showOriginal();

      setStatus(
        "Image loaded. Choose your settings and click Convert Image."
      );
    },
    () => {
      URL.revokeObjectURL(url);
      setStatus("Could not load the image.");
    }
  );
}

function showOriginal() {
  if (!sourceImage) return;

  const scale = Math.min(
    MAX_PREVIEW_SIZE / sourceImage.width,
    MAX_PREVIEW_SIZE / sourceImage.height,
    1
  );

  const w = Math.max(
    1,
    Math.round(sourceImage.width * scale)
  );

  const h = Math.max(
    1,
    Math.round(sourceImage.height * scale)
  );

  resizeCanvas(w, h);

  clear();
  image(sourceImage, 0, 0, w, h);
}

// ------------------------------------------
// CONTRAST
// ------------------------------------------

function adjustContrast(img, contrastPercent) {
  const result = img.get();
  const factor = contrastPercent / 100;

  result.loadPixels();

  for (let i = 0; i < result.pixels.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const value = result.pixels[i + c];

      result.pixels[i + c] = constrain(
        (value - 128) * factor + 128,
        0,
        255
      );
    }
  }

  result.updatePixels();

  return result;
}

// ------------------------------------------
// PREPARE IMAGE FOR COLOR MATCHING
// ------------------------------------------

// The color-matching algorithm expects RGB values.
// Transparent pixels can contain hidden black RGB data.
// Composite against white before color matching.

function compositeOnWhite(img) {
  const result = createImage(img.width, img.height);

  img.loadPixels();
  result.loadPixels();

  for (let p = 0; p < img.pixels.length; p += 4) {
    const alpha = img.pixels[p + 3] / 255;

    for (let c = 0; c < 3; c++) {
      result.pixels[p + c] = Math.round(
        img.pixels[p + c] * alpha +
        255 * (1 - alpha)
      );
    }

    result.pixels[p + 3] = 255;
  }

  result.updatePixels();

  return result;
}

// ------------------------------------------
// PRESERVE TRANSPARENCY
// ------------------------------------------

function preserveTransparency(channel, originalImage) {
  channel.loadPixels();
  originalImage.loadPixels();

  for (let p = 0; p < channel.pixels.length; p += 4) {
    const originalAlpha = originalImage.pixels[p + 3] / 255;

    channel.pixels[p + 3] = Math.round(
      channel.pixels[p + 3] * originalAlpha
    );
  }

  channel.updatePixels();

  return channel;
}

// ------------------------------------------
// CONVERT BUTTON
// ------------------------------------------

function convertImage() {
  if (busy) return;

  if (!sourceImage) {
    setStatus("Please upload an image first.");
    return;
  }

  const count = Number(
    document.getElementById("inkCount").value
  );

  const inkNames = [
    document.getElementById("ink1").value,
    document.getElementById("ink2").value,
    document.getElementById("ink3").value
  ].slice(0, count);

  if (new Set(inkNames).size !== count) {
    setStatus("Please select different ink colors.");
    return;
  }

  const method = document.getElementById("method").value;

  const contrast = Number(
    document.getElementById("contrast").value
  );

  const quality = Number(
    document.getElementById("quality").value
  );

  invalidateConversion();

  busy = true;
  document.getElementById("convert").disabled = true;

  setStatus("Converting image. Please wait...");

  setTimeout(() => {
    try {
      performConversion(
        inkNames,
        method,
        contrast,
        quality
      );
    } catch (error) {
      console.error(error);

      setStatus(
        "Conversion failed. Try Fast precision or a smaller image."
      );
    } finally {
      busy = false;
      document.getElementById("convert").disabled = false;
    }
  }, 30);
}

// ------------------------------------------
// MAIN CONVERSION
// ------------------------------------------

function performConversion(inkNames, method, contrast, quality) {
  Riso.channels = [];

  inkLayers = [];
  separatedImages = [];

  const scale = Math.min(
    1,
    Math.sqrt(
      MAX_PROCESS_PIXELS /
      (sourceImage.width * sourceImage.height)
    )
  );

  const w = Math.max(
    1,
    Math.round(sourceImage.width * scale)
  );

  const h = Math.max(
    1,
    Math.round(sourceImage.height * scale)
  );

  resizeCanvas(w, h);
  pixelDensity(1);

  // Preserve original alpha information.
  const workingImage = sourceImage.get();
  workingImage.resize(w, h);

  // Create an opaque image for RGB color matching.
  const opaqueImage = compositeOnWhite(workingImage);

  const adjustedImage = adjustContrast(
    opaqueImage,
    contrast
  );

  // Create either two or three ink layers.
  inkLayers = inkNames.map((name) => {
    return new Riso(name, w, h);
  });

  // Calculate color separations.
  const channels = extractMappedChannels(
    adjustedImage,
    quality,
    false
  );

  // Apply original transparency to every ink channel.
  channels.forEach((channel) => {
    preserveTransparency(channel, workingImage);
  });

  for (let i = 0; i < inkLayers.length; i++) {
    const channel = channels[i];

    const grayscale = createImage(w, h);

    grayscale.loadPixels();
    channel.loadPixels();

    for (let p = 0; p < channel.pixels.length; p += 4) {
      const coverage = channel.pixels[p + 3] / 255;
      const gray = Math.round(255 * (1 - coverage));

      grayscale.pixels[p] = gray;
      grayscale.pixels[p + 1] = gray;
      grayscale.pixels[p + 2] = gray;
      grayscale.pixels[p + 3] = 255;
    }

    grayscale.updatePixels();

    let processed = grayscale;

    if (method !== "continuous") {
      processed = ditherImage(
        grayscale,
        method,
        128
      );
    }

    // Store grayscale separation for printing.
    separatedImages.push(processed);

    // Build transparent preview layer.
    const mask = createImage(w, h);

    mask.loadPixels();
    processed.loadPixels();

    for (let p = 0; p < processed.pixels.length; p += 4) {
      const coverage = 255 - processed.pixels[p];

      mask.pixels[p] = 0;
      mask.pixels[p + 1] = 0;
      mask.pixels[p + 2] = 0;
      mask.pixels[p + 3] = coverage;
    }

    mask.updatePixels();

    inkLayers[i].clear();
    inkLayers[i].fill(255);
    inkLayers[i].image(mask, 0, 0, w, h);
  }

  // Render on a transparent canvas.
  clear();
  drawRiso();

  converted = true;

  document.getElementById("export").disabled = false;

  setStatus(
    "Conversion complete using " +
    inkNames.length +
    " inks: " +
    inkNames.join(" + ")
  );
}

// ------------------------------------------
// EXPORT GRAYSCALE INK SEPARATIONS
// ------------------------------------------

function exportLayers() {
  if (!converted || separatedImages.length === 0) {
    setStatus("Please convert an image first.");
    return;
  }

  separatedImages.forEach((img, index) => {
    const inkName = inkLayers[index].channelName;

    save(
      img,
      (index + 1) + "_" + inkName + ".png"
    );
  });

  setStatus(
    separatedImages.length +
    " grayscale ink separations exported."
  );
}
