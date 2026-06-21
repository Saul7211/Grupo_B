import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import dotenv from 'dotenv';
import { loginOrRegisterGoogle } from './database.js';

dotenv.config();

passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
},
async (accessToken, refreshToken, profile, done) => {
    try {
        const email       = profile.emails?.[0]?.value || null;
        const displayName = profile.displayName || email || `google_${profile.id}`;
        const photo       = profile.photos?.[0]?.value || null;

        const user = await loginOrRegisterGoogle({ email, displayName, googleId: profile.id });

        // Datos extra SOLO para la pantalla (no se guardan en la BD)
        user.email        = email;
        user.photo        = photo;
        user.authProvider = 'google';

        return done(null, user);
    } catch (err) {
        return done(err);
    }
}
));

export default passport;