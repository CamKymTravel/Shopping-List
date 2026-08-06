export const STORE_OPTIONS = ["Either", "Coles", "Woolworths"];

export const CATEGORIES = [
  { id: "fruit-veg", name: "Fruit & Vegetables", shortName: "Fruit & Veg", emoji: "🍎🥕", accent: "#24943b", tint: "#eff9eb" },
  { id: "meat-seafood", name: "Meat & Seafood", shortName: "Meat & Seafood", emoji: "🥩🐟", accent: "#b6453d", tint: "#fff0ed" },
  { id: "dairy-eggs", name: "Dairy & Eggs", shortName: "Dairy & Eggs", emoji: "🥛🧀", accent: "#1269c7", tint: "#eef7ff" },
  { id: "bakery", name: "Bakery", shortName: "Bakery", emoji: "🍞🥐", accent: "#b46b13", tint: "#fff5e8" },
  { id: "pantry", name: "Pantry", shortName: "Pantry", emoji: "🥫🍝", accent: "#e96f12", tint: "#fff3e6" },
  { id: "frozen", name: "Frozen", shortName: "Frozen", emoji: "❄️🍨", accent: "#3185b9", tint: "#eef9ff" },
  { id: "drinks", name: "Drinks", shortName: "Drinks", emoji: "🧃☕", accent: "#137c8c", tint: "#eafafa" },
  { id: "household", name: "Household", shortName: "Household", emoji: "🧴🧻", accent: "#6d3db5", tint: "#f4effc" },
  { id: "toiletries", name: "Toiletries", shortName: "Toiletries", emoji: "🧼🪥", accent: "#b73e8b", tint: "#fff0f8" },
  { id: "pharmacy", name: "Pharmacy", shortName: "Pharmacy", emoji: "🩹🌡️", accent: "#d34b4b", tint: "#fff0f0" },
  { id: "pet-supplies", name: "Pet Supplies", shortName: "Pet Supplies", emoji: "🐾🥫", accent: "#7d6532", tint: "#f8f3e8" },
  { id: "other", name: "Other", shortName: "Other", emoji: "🛒➕", accent: "#596677", tint: "#f0f3f6" }
];

const ITEMS = {
  "fruit-veg": ["Apples", "Bananas", "Oranges", "Mandarins", "Lemons", "Limes", "Grapes", "Strawberries", "Blueberries", "Watermelon", "Avocado", "Tomatoes", "Cherry Tomatoes", "Potatoes", "Sweet Potato", "Onions", "Red Onions", "Garlic", "Carrots", "Broccoli", "Cauliflower", "Capsicum", "Cucumber", "Lettuce", "Spinach", "Mushrooms", "Zucchini", "Pumpkin", "Celery", "Green Beans", "Peas", "Corn", "Fresh Herbs", "Salad Mix"],
  "meat-seafood": ["Chicken Breast", "Chicken Thighs", "Whole Chicken", "Beef Mince", "Steak", "Sausages", "Bacon", "Ham", "Pork Chops", "Lamb Chops", "Roast Meat", "Meatballs", "Burger Patties", "Fish Fillets", "Salmon", "Prawns", "Canned Tuna", "Deli Meat"],
  "dairy-eggs": ["Milk", "Lactose-Free Milk", "Cream", "Butter", "Margarine", "Eggs", "Cheese", "Sliced Cheese", "Yoghurt", "Sour Cream", "Cottage Cheese", "Custard", "Ice Cream"],
  "bakery": ["Bread", "Wholemeal Bread", "White Bread", "Rolls", "Wraps", "Pita Bread", "English Muffins", "Crumpets", "Bagels", "Croissants", "Cakes", "Muffins"],
  "pantry": ["Rice", "Pasta", "Noodles", "Cereal", "Oats", "Flour", "Sugar", "Salt", "Pepper", "Cooking Oil", "Olive Oil", "Vinegar", "Sauces", "Tomato Sauce", "Barbecue Sauce", "Mayonnaise", "Mustard", "Jam", "Honey", "Peanut Butter", "Vegemite", "Canned Tomatoes", "Baked Beans", "Canned Soup", "Canned Vegetables", "Canned Fruit", "Stock", "Herbs and Spices", "Crackers", "Biscuits", "Chips", "Corn Chips", "Nuts", "Tea", "Coffee", "Hot Chocolate"],
  "frozen": ["Frozen Vegetables", "Frozen Peas", "Frozen Chips", "Frozen Fruit", "Frozen Meals", "Frozen Pizza", "Fish Fingers", "Frozen Desserts", "Ice Cream"],
  "drinks": ["Water", "Sparkling Water", "Soft Drink", "Juice", "Cordial", "Milk Drinks", "Sports Drinks", "Tea", "Coffee"],
  "household": ["Toilet Paper", "Paper Towel", "Tissues", "Rubbish Bags", "Cling Wrap", "Aluminium Foil", "Baking Paper", "Dishwashing Liquid", "Dishwasher Tablets", "Laundry Detergent", "Fabric Softener", "Stain Remover", "Surface Cleaner", "Disinfectant", "Bathroom Cleaner", "Sponges", "Cleaning Cloths", "Batteries", "Light Bulbs"],
  "toiletries": ["Soap", "Body Wash", "Shampoo", "Conditioner", "Toothpaste", "Toothbrushes", "Dental Floss", "Deodorant", "Moisturiser", "Sunscreen", "Razors", "Shaving Cream", "Sanitary Products", "Cotton Buds"],
  "pharmacy": ["Bandages", "Antiseptic", "Pain Relief", "Cold and Flu Supplies", "Thermometer Supplies"],
  "pet-supplies": ["Pet Food", "Pet Treats", "Cat Litter", "Waste Bags", "Pet Shampoo", "Pet Medication Reminder"],
  "other": []
};

function stableItemId(categoryId, name) {
  return `preset:${categoryId}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

export const PRESET_ITEMS = Object.entries(ITEMS).flatMap(([categoryId, names], categoryIndex) =>
  names.map((name, itemIndex) => ({
    id: stableItemId(categoryId, name),
    categoryId,
    name,
    defaultStore: "Either",
    isCustom: false,
    sortOrder: categoryIndex * 1000 + itemIndex
  }))
);

export const MEAL_IDEAS = [
  "Roast chicken", "Spaghetti bolognese", "Fish and chips", "Sausages and vegetables",
  "Soup", "Sandwiches", "Stir-fry", "Tacos", "Curry", "Salad", "Baked dinner",
  "Barbecue", "Takeaway night"
];
