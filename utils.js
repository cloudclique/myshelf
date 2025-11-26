// utils.js

// --- Constants for Dropdown Options ---

export const CATEGORY_OPTIONS = [
    "Prepainted Figure", "GK Figure", "Plush", "Model Kit", "Statue", "Acrylic Stand", "Other"
];

export const SCALE_OPTIONS = [
    "Non-Scale", "1/4", "1/5","1/6", "1/7", "1/8", "1/10", "1/12", "Other"
];

export const AGERATING_OPTIONS = [
    "All Ages", "13+", "16+", "18+"
];

// --- Utility Functions ---

/**
 * Creates and returns an HTML element for an item card.
 * @param {object} item - The item data object from Firestore.
 * @param {boolean} showEdit - Whether to include the Edit/Delete buttons (used on profile page).
 * @returns {HTMLElement} The created item card element.
 */
export function createItemCard(item, showEdit = false) {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.setAttribute('data-id', item.id);

    // Default image if imageUrl is missing or empty
    const imageUrl = item.imageData || 'https://via.placeholder.com/200?text=No+Image';

    let buttonsHtml = '';
    if (showEdit) {
        buttonsHtml = `
            <div class="card-actions">
                <button class="edit-btn" data-id="${item.id}">Edit</button>
                <button class="delete-btn" data-id="${item.id}">Delete</button>
            </div>
        `;
    }

    card.innerHTML = `
        <a href="item-details.html?id=${item.id}">
            <img src="${imageUrl}" alt="${item.title}" class="item-image">
            <div class="item-info">
                <h3 class="item-title">${item.title}</h3>
                <p class="item-manufacturer">${item.manufacturer || 'N/A'}</p>
                <p class="item-price">Price: $${item.price ? item.price.toFixed(2) : 'N/A'}</p>
            </div>
        </a>
        ${buttonsHtml}
    `;

    return card;
}

/**
 * Populates a select element with options from an array.
 * @param {string} selectId - The ID of the <select> element.
 * @param {string[]} options - Array of option strings.
 * @param {string} defaultValue - Optional value to pre-select.
 */
export function populateDropdown(selectId, options, defaultValue = "") {
    const select = document.getElementById(selectId);
    if (!select) return;

    // Clear existing options
    select.innerHTML = '';
    
    // Add default "All" or "Select" option
    const labelText = select.previousElementSibling?.textContent.replace(':', '').trim() || 'Select Option';

    const defaultOption = document.createElement('option');
    defaultOption.value = "";
    defaultOption.textContent = `-- ${labelText} --`; 
    select.appendChild(defaultOption);


    options.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        if (option === defaultValue) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
}

/**
 * Converts a File object to a Base64 encoded string.
 * @param {File} file - The image file to convert.
 * @returns {Promise<string>} A promise that resolves to the Base64 string.
 */
export function toBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}