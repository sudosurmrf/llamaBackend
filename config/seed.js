import 'dotenv/config';
import bcrypt from 'bcrypt';
import pg from 'pg';

const { Pool } = pg;

// Support both DATABASE_URL (Railway/Heroku) and individual env vars
const connectionConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'llama_bakery',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
    };

const pool = new Pool(connectionConfig);

// Seed data
const seedData = {
  // Admin user (password: admin123)
  users: [
    {
      email: 'admin@llamatreats.com',
      password: 'admin123',
      name: 'Admin User',
      role: 'admin',
    },
    {
      email: 'baker@llamatreats.com',
      password: 'baker123',
      name: 'Head Baker',
      role: 'baker',
    },
  ],

  categories: [
    {
      name: 'Cookies',
      slug: 'cookies',
      description: 'Freshly baked cookies in various delicious flavors. Made with premium ingredients and baked to perfection.',
      display_order: 1,
      active: true,
    },
    {
      name: 'Cakes',
      slug: 'cakes',
      description: 'Custom cakes for every occasion. From birthdays to weddings, we create memorable centerpieces.',
      display_order: 2,
      active: true,
    },
    {
      name: 'Cupcakes',
      slug: 'cupcakes',
      description: 'Delightful mini treats topped with our signature frosting. Perfect for parties and gifts.',
      display_order: 3,
      active: true,
    },
    {
      name: 'Pastries',
      slug: 'pastries',
      description: 'Flaky, buttery pastries made fresh daily. A perfect companion for your morning coffee.',
      display_order: 4,
      active: true,
    },
    {
      name: 'Breads',
      slug: 'breads',
      description: 'Artisan breads baked with love using traditional methods and quality ingredients.',
      display_order: 5,
      active: true,
    },
    {
      name: 'Seasonal',
      slug: 'seasonal',
      description: 'Limited time seasonal specials featuring the best flavors of the season.',
      display_order: 6,
      active: true,
    },
  ],

  products: [
    // Cookies
    {
      name: 'Classic Chocolate Chip Cookie',
      slug: 'classic-chocolate-chip-cookie',
      description: 'Our signature cookie loaded with premium chocolate chips. Crispy on the outside, chewy on the inside.',
      price: 3.50,
      category_slug: 'cookies',
      featured: true,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, butter, brown sugar, chocolate chips, eggs, vanilla extract, baking soda, salt',
      nutrition_info: { calories: 280, fat: 14, carbs: 36, protein: 3 },
      servings: '1 cookie',
    },
    {
      name: 'Double Chocolate Brownie Cookie',
      slug: 'double-chocolate-brownie-cookie',
      description: 'Rich, fudgy cookie combining the best of brownies and cookies. A chocolate lover\'s dream.',
      price: 4.00,
      category_slug: 'cookies',
      featured: true,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, cocoa powder, butter, sugar, chocolate chunks, eggs, vanilla',
      nutrition_info: { calories: 320, fat: 16, carbs: 42, protein: 4 },
      servings: '1 cookie',
    },
    {
      name: 'Oatmeal Raisin Cookie',
      slug: 'oatmeal-raisin-cookie',
      description: 'Hearty oatmeal cookies studded with plump raisins and a hint of cinnamon.',
      price: 3.25,
      category_slug: 'cookies',
      featured: false,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Oats, flour, butter, brown sugar, raisins, eggs, cinnamon, baking soda',
      nutrition_info: { calories: 260, fat: 11, carbs: 38, protein: 4 },
      servings: '1 cookie',
    },
    {
      name: 'Peanut Butter Cookie',
      slug: 'peanut-butter-cookie',
      description: 'Classic peanut butter cookies with that iconic crosshatch pattern. Rich and nutty.',
      price: 3.50,
      category_slug: 'cookies',
      featured: false,
      active: true,
      allergens: ['wheat', 'eggs', 'peanuts'],
      ingredients: 'Peanut butter, flour, butter, sugar, eggs, vanilla, baking soda',
      nutrition_info: { calories: 290, fat: 16, carbs: 32, protein: 6 },
      servings: '1 cookie',
    },

    // Cakes
    {
      name: 'Classic Vanilla Birthday Cake',
      slug: 'classic-vanilla-birthday-cake',
      description: 'Light and fluffy vanilla cake with our signature buttercream frosting. Perfect for celebrations.',
      price: 45.00,
      category_slug: 'cakes',
      featured: true,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, sugar, butter, eggs, vanilla extract, milk, baking powder',
      nutrition_info: { calories: 380, fat: 18, carbs: 52, protein: 5 },
      servings: 'Serves 12-16',
    },
    {
      name: 'Decadent Chocolate Layer Cake',
      slug: 'decadent-chocolate-layer-cake',
      description: 'Three layers of moist chocolate cake with rich chocolate ganache. Chocolate heaven.',
      price: 55.00,
      category_slug: 'cakes',
      featured: true,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, cocoa powder, sugar, butter, eggs, buttermilk, chocolate, cream',
      nutrition_info: { calories: 450, fat: 24, carbs: 58, protein: 6 },
      servings: 'Serves 12-16',
    },
    {
      name: 'Red Velvet Cake',
      slug: 'red-velvet-cake',
      description: 'Beautiful red velvet cake with tangy cream cheese frosting. A Southern classic.',
      price: 50.00,
      category_slug: 'cakes',
      featured: false,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, cocoa, buttermilk, eggs, butter, cream cheese, vanilla',
      nutrition_info: { calories: 410, fat: 20, carbs: 54, protein: 5 },
      servings: 'Serves 12-16',
    },
    {
      name: 'Carrot Cake',
      slug: 'carrot-cake',
      description: 'Moist spiced carrot cake with walnuts and cream cheese frosting.',
      price: 48.00,
      category_slug: 'cakes',
      featured: false,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy', 'tree nuts'],
      ingredients: 'Carrots, flour, sugar, eggs, oil, walnuts, cinnamon, cream cheese',
      nutrition_info: { calories: 420, fat: 22, carbs: 50, protein: 5 },
      servings: 'Serves 12-16',
    },

    // Cupcakes
    {
      name: 'Vanilla Dream Cupcake',
      slug: 'vanilla-dream-cupcake',
      description: 'Light vanilla cupcake topped with swirls of vanilla buttercream and rainbow sprinkles.',
      price: 4.50,
      category_slug: 'cupcakes',
      featured: true,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, sugar, butter, eggs, vanilla, milk, sprinkles',
      nutrition_info: { calories: 340, fat: 16, carbs: 46, protein: 4 },
      servings: '1 cupcake',
    },
    {
      name: 'Chocolate Fudge Cupcake',
      slug: 'chocolate-fudge-cupcake',
      description: 'Rich chocolate cupcake with chocolate fudge frosting and chocolate shavings.',
      price: 4.75,
      category_slug: 'cupcakes',
      featured: true,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, cocoa, sugar, butter, eggs, chocolate, cream',
      nutrition_info: { calories: 380, fat: 18, carbs: 52, protein: 5 },
      servings: '1 cupcake',
    },
    {
      name: 'Strawberry Bliss Cupcake',
      slug: 'strawberry-bliss-cupcake',
      description: 'Fresh strawberry cupcake with strawberry cream cheese frosting.',
      price: 5.00,
      category_slug: 'cupcakes',
      featured: false,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, sugar, butter, eggs, fresh strawberries, cream cheese',
      nutrition_info: { calories: 320, fat: 14, carbs: 44, protein: 4 },
      servings: '1 cupcake',
    },
    {
      name: 'Salted Caramel Cupcake',
      slug: 'salted-caramel-cupcake',
      description: 'Buttery cupcake filled with caramel and topped with salted caramel buttercream.',
      price: 5.25,
      category_slug: 'cupcakes',
      featured: false,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, sugar, butter, eggs, caramel, sea salt, vanilla',
      nutrition_info: { calories: 360, fat: 17, carbs: 48, protein: 4 },
      servings: '1 cupcake',
    },

    // Pastries
    {
      name: 'Butter Croissant',
      slug: 'butter-croissant',
      description: 'Flaky, buttery croissant made with imported French butter. 72 layers of perfection.',
      price: 4.25,
      category_slug: 'pastries',
      featured: true,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, butter, milk, yeast, sugar, salt, eggs',
      nutrition_info: { calories: 290, fat: 17, carbs: 31, protein: 5 },
      servings: '1 croissant',
    },
    {
      name: 'Almond Croissant',
      slug: 'almond-croissant',
      description: 'Our butter croissant filled with almond cream and topped with sliced almonds.',
      price: 5.50,
      category_slug: 'pastries',
      featured: true,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy', 'tree nuts'],
      ingredients: 'Flour, butter, almonds, almond paste, sugar, eggs',
      nutrition_info: { calories: 380, fat: 22, carbs: 38, protein: 8 },
      servings: '1 croissant',
    },
    {
      name: 'Danish Pastry',
      slug: 'danish-pastry',
      description: 'Traditional Danish pastry with seasonal fruit and vanilla custard.',
      price: 4.75,
      category_slug: 'pastries',
      featured: false,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, butter, eggs, milk, vanilla, seasonal fruit',
      nutrition_info: { calories: 340, fat: 18, carbs: 42, protein: 5 },
      servings: '1 pastry',
    },
    {
      name: 'Cinnamon Roll',
      slug: 'cinnamon-roll',
      description: 'Soft, gooey cinnamon roll with cream cheese glaze. Best served warm.',
      price: 5.00,
      category_slug: 'pastries',
      featured: false,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, butter, cinnamon, brown sugar, cream cheese, vanilla',
      nutrition_info: { calories: 420, fat: 18, carbs: 60, protein: 6 },
      servings: '1 roll',
    },

    // Breads
    {
      name: 'Sourdough Loaf',
      slug: 'sourdough-loaf',
      description: 'Traditional sourdough bread with a crispy crust and tangy flavor. 24-hour fermentation.',
      price: 8.00,
      category_slug: 'breads',
      featured: true,
      active: true,
      allergens: ['wheat'],
      ingredients: 'Flour, water, salt, sourdough starter',
      nutrition_info: { calories: 120, fat: 1, carbs: 24, protein: 4 },
      servings: 'Makes 16 slices',
    },
    {
      name: 'French Baguette',
      slug: 'french-baguette',
      description: 'Classic French baguette with a crackling crust and soft interior.',
      price: 5.00,
      category_slug: 'breads',
      featured: false,
      active: true,
      allergens: ['wheat'],
      ingredients: 'Flour, water, yeast, salt',
      nutrition_info: { calories: 140, fat: 1, carbs: 28, protein: 5 },
      servings: '1 baguette',
    },
    {
      name: 'Brioche Loaf',
      slug: 'brioche-loaf',
      description: 'Rich, buttery brioche perfect for French toast or sandwiches.',
      price: 9.00,
      category_slug: 'breads',
      featured: false,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, butter, eggs, milk, sugar, yeast',
      nutrition_info: { calories: 180, fat: 8, carbs: 24, protein: 5 },
      servings: 'Makes 12 slices',
    },

    // Seasonal
    {
      name: 'Pumpkin Spice Latte Cookie',
      slug: 'pumpkin-spice-latte-cookie',
      description: 'Limited edition cookie with real pumpkin, warm spices, and espresso frosting.',
      price: 4.50,
      category_slug: 'seasonal',
      featured: true,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, pumpkin puree, butter, spices, espresso, cream cheese',
      nutrition_info: { calories: 310, fat: 14, carbs: 42, protein: 4 },
      servings: '1 cookie',
    },
    {
      name: 'Apple Cider Donut',
      slug: 'apple-cider-donut',
      description: 'Cake donut made with fresh apple cider and coated in cinnamon sugar.',
      price: 3.75,
      category_slug: 'seasonal',
      featured: true,
      active: true,
      allergens: ['wheat', 'eggs', 'dairy'],
      ingredients: 'Flour, apple cider, butter, eggs, cinnamon, sugar, nutmeg',
      nutrition_info: { calories: 280, fat: 12, carbs: 40, protein: 3 },
      servings: '1 donut',
    },
  ],

  // Specials will be built dynamically after categories are seeded (to get category IDs)
  specialsTemplate: [
    {
      name: 'Cookie Dozen Deal',
      description: 'Buy a dozen cookies and save 20%! Mix and match any flavors.',
      type: 'discount_percentage',
      value: 20,
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      active: true,
      code: 'DOZEN20',
      category_slugs: ['cookies'], // Will be converted to category_ids
    },
    {
      name: 'Birthday Cake Bundle',
      description: 'Get $10 off when you buy any cake! Perfect for celebrations.',
      type: 'bundle_discount',
      value: 10,
      min_purchase: 40,
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      active: true,
      code: 'CAKEBUNDLE',
      category_slugs: ['cakes'],
    },
    {
      name: 'Buy 1 Cake, Get 6 Cupcakes Free',
      description: 'Purchase any cake and choose 6 cupcakes absolutely FREE!',
      type: 'buy_x_get_y',
      value: {
        buy_quantity: 1,
        get_quantity: 6,
        // buy_category_ids and get_category_ids will be populated dynamically
      },
      buy_category_slugs: ['cakes'],
      get_category_slugs: ['cupcakes'],
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      active: true,
      code: 'CAKECUPCAKES',
    },
    {
      name: 'Morning Pastry Deal',
      description: 'Buy 2 pastries and get 1 free! Perfect for breakfast.',
      type: 'buy_x_get_y',
      value: {
        buy_quantity: 2,
        get_quantity: 1,
      },
      buy_category_slugs: ['pastries'],
      get_category_slugs: ['pastries'],
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      active: true,
      code: 'PASTRY21',
    },
  ],

  promotions: [
    {
      name: 'Hero Banner - Welcome',
      title: 'Welcome to Llama Treats Bakery',
      subtitle: 'Handcrafted with love since 2020',
      description: 'Experience the finest baked goods made fresh daily with premium ingredients.',
      button_text: 'View Our Menu',
      button_link: '/menu',
      background_color: '#f8e8d4',
      text_color: '#5c3d2e',
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      active: true,
      display_location: 'homepage_hero',
      display_order: 1,
    },
    {
      name: 'Hero Banner - Fresh Daily',
      title: 'Baked Fresh Every Morning',
      subtitle: 'From our oven to your table',
      description: 'Our artisan bakers start at 4am to ensure you get the freshest treats possible.',
      button_text: 'Shop Now',
      button_link: '/menu',
      background_color: '#d4a574',
      text_color: '#ffffff',
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      active: true,
      display_location: 'homepage_hero',
      display_order: 2,
    },
    {
      name: 'Seasonal Promo',
      title: 'Fall Favorites Are Here!',
      subtitle: 'Limited time seasonal treats',
      description: 'Try our pumpkin spice and apple cider creations before they\'re gone.',
      button_text: 'See Seasonal Menu',
      button_link: '/menu?category=seasonal',
      background_color: '#c17f59',
      text_color: '#ffffff',
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      active: true,
      display_location: 'homepage_banner',
      display_order: 1,
    },
  ],

  banners: [
    {
      title: 'Free Local Delivery',
      message: 'Free delivery on orders over $30 within 5 miles!',
      type: 'info',
      dismissible: true,
      active: true,
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      display_location: 'site_wide',
      link: '/menu',
      link_text: 'Order Now',
    },
    {
      title: 'Holiday Pre-Orders Open',
      message: 'Pre-order your holiday cakes and cookies now to secure your spot!',
      type: 'warning',
      dismissible: true,
      active: true,
      start_date: new Date().toISOString(),
      end_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      display_location: 'homepage',
      link: '/contact',
      link_text: 'Pre-Order',
    },
  ],

  settings: {
    bakery_name: 'Llama Treats Bakery',
    tagline: 'Handcrafted with love',
    phone: '(555) 123-CAKE',
    email: 'hello@llamatreats.com',
    address: '123 Baker Street, Llamaville, CA 90210',
    hours: {
      monday: { open: '07:00', close: '18:00', closed: false },
      tuesday: { open: '07:00', close: '18:00', closed: false },
      wednesday: { open: '07:00', close: '18:00', closed: false },
      thursday: { open: '07:00', close: '18:00', closed: false },
      friday: { open: '07:00', close: '19:00', closed: false },
      saturday: { open: '08:00', close: '17:00', closed: false },
      sunday: { open: '09:00', close: '15:00', closed: false },
    },
    social: {
      facebook: 'https://facebook.com/llamatreats',
      instagram: 'https://instagram.com/llamatreats',
      twitter: 'https://twitter.com/llamatreats',
      tiktok: 'https://tiktok.com/@llamatreats',
    },
  },
};

async function seed() {
  console.log('Starting database seed...\n');

  try {
    // Clear existing data (in reverse order of dependencies)
    console.log('Clearing existing data...');
    await pool.query('DELETE FROM settings');
    await pool.query('DELETE FROM banners');
    await pool.query('DELETE FROM promotions');
    await pool.query('DELETE FROM specials');
    await pool.query('DELETE FROM products');
    await pool.query('DELETE FROM categories');
    await pool.query('DELETE FROM users');
    console.log('Existing data cleared.\n');

    // Seed users
    console.log('Seeding users...');
    for (const user of seedData.users) {
      const passwordHash = await bcrypt.hash(user.password, 10);
      await pool.query(
        `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)`,
        [user.email, passwordHash, user.name, user.role]
      );
      console.log(`  Created user: ${user.email} (password: ${user.password})`);
    }
    console.log('');

    // Seed categories
    console.log('Seeding categories...');
    const categoryMap = {};
    for (const category of seedData.categories) {
      const result = await pool.query(
        `INSERT INTO categories (name, slug, description, display_order, active)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [category.name, category.slug, category.description, category.display_order, category.active]
      );
      categoryMap[category.slug] = result.rows[0].id;
      console.log(`  Created category: ${category.name}`);
    }
    console.log('');

    // Seed products
    console.log('Seeding products...');
    for (const product of seedData.products) {
      const categoryId = categoryMap[product.category_slug];
      await pool.query(
        `INSERT INTO products (name, slug, description, price, category_id, featured, active, allergens, ingredients, nutrition_info, servings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          product.name,
          product.slug,
          product.description,
          product.price,
          categoryId,
          product.featured,
          product.active,
          product.allergens,
          product.ingredients,
          product.nutrition_info,
          product.servings,
        ]
      );
      console.log(`  Created product: ${product.name}`);
    }
    console.log('');

    // Seed specials (using categoryMap to resolve category slugs to IDs)
    console.log('Seeding specials...');
    for (const template of seedData.specialsTemplate) {
      // Convert category slugs to IDs
      const categoryIds = (template.category_slugs || [])
        .map(slug => categoryMap[slug])
        .filter(Boolean);

      // For buy_x_get_y, add category IDs to the value object
      let value = template.value;
      if (template.type === 'buy_x_get_y') {
        const buyCategoryIds = (template.buy_category_slugs || [])
          .map(slug => categoryMap[slug])
          .filter(Boolean);
        const getCategoryIds = (template.get_category_slugs || [])
          .map(slug => categoryMap[slug])
          .filter(Boolean);

        value = {
          ...template.value,
          buy_category_ids: buyCategoryIds,
          get_category_ids: getCategoryIds,
        };
      }

      await pool.query(
        `INSERT INTO specials (name, description, type, value, category_ids, start_date, end_date, active, min_purchase, code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          template.name,
          template.description,
          template.type,
          JSON.stringify(value),
          categoryIds,
          template.start_date,
          template.end_date,
          template.active,
          template.min_purchase || null,
          template.code,
        ]
      );
      console.log(`  Created special: ${template.name} (code: ${template.code})`);
    }
    console.log('');

    // Seed promotions
    console.log('Seeding promotions...');
    for (const promo of seedData.promotions) {
      await pool.query(
        `INSERT INTO promotions (name, title, subtitle, description, button_text, button_link, background_color, text_color, start_date, end_date, active, display_location, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          promo.name,
          promo.title,
          promo.subtitle,
          promo.description,
          promo.button_text,
          promo.button_link,
          promo.background_color,
          promo.text_color,
          promo.start_date,
          promo.end_date,
          promo.active,
          promo.display_location,
          promo.display_order,
        ]
      );
      console.log(`  Created promotion: ${promo.name}`);
    }
    console.log('');

    // Seed banners
    console.log('Seeding banners...');
    for (const banner of seedData.banners) {
      await pool.query(
        `INSERT INTO banners (title, message, type, dismissible, active, start_date, end_date, display_location, link, link_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          banner.title,
          banner.message,
          banner.type,
          banner.dismissible,
          banner.active,
          banner.start_date,
          banner.end_date,
          banner.display_location,
          banner.link,
          banner.link_text,
        ]
      );
      console.log(`  Created banner: ${banner.title}`);
    }
    console.log('');

    // Seed settings
    console.log('Seeding settings...');
    for (const [key, value] of Object.entries(seedData.settings)) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)`,
        [key, JSON.stringify(value)]
      );
      console.log(`  Set setting: ${key}`);
    }
    console.log('');

    console.log('========================================');
    console.log('Database seeded successfully!');
    console.log('========================================\n');
    console.log('Test credentials:');
    console.log('  Admin: admin@llamatreats.com / admin123');
    console.log('  Baker: baker@llamatreats.com / baker123');
    console.log('');
    console.log('Promo codes:');
    console.log('  DOZEN20 - 20% off cookies');
    console.log('  CAKEBUNDLE - $10 off cakes (min $40)');
    console.log('  CAKECUPCAKES - Buy 1 cake, get 6 cupcakes free');
    console.log('  PASTRY21 - Buy 2 pastries, get 1 free');
    console.log('');

  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run seed
seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
