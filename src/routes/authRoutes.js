import { registerUser, loginUser, guestLogin, googleCallback, oauthGoogle, oauthApple, forgotPassword, resetPassword, verifyRegistrationOtp, verifyRegistrationWithReference, verifyRemoteToken, registerUserWithFirebaseToken } from '../controllers/authController.js';
// import cloudinaryStream from '../middlewares/cloudinaryStream.js';

export default async function (fastify, opts) {
  const registerSchema = {
    body: {
      type: 'object',
      required: ['email'],
      properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 },
        googleIdToken: { type: 'string' }
      },
    },
  };

  const loginSchema = {
    body: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string' },
      },
    },
  };

  // Registration may be JSON (normal users) or multipart (with profile image).

  fastify.post('/register', { schema: registerSchema }, registerUser);
  fastify.post('/login', { schema: loginSchema }, loginUser);
  fastify.post('/guest', guestLogin);
  // Accept either `idToken` or `id_token` in the request body (some clients use different names)
  fastify.post('/oauth/google', { schema: { body: { type: 'object', properties: { idToken: { type: 'string' }, id_token: { type: 'string' }, role: { type: 'string' } } } } }, oauthGoogle);
  fastify.get('/google/callback', googleCallback);
  // Accept either an Apple `identityToken`+`nonce` (mobile flow) OR an `authorizationCode` to exchange on the server
  fastify.post('/oauth/apple', { schema: { body: { type: 'object', properties: { identityToken: { type: 'string' }, nonce: { type: 'string' }, authorizationCode: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, role: { type: 'string' } } } } }, oauthApple);
  
  // Password reset routes
  fastify.post('/forgot-password', { 
    schema: { 
      body: { 
        type: 'object', 
        required: ['email'], 
        properties: { email: { type: 'string', format: 'email' } } 
      } 
    } 
  }, forgotPassword);
  
  fastify.post('/reset-password', { 
    schema: { 
      body: { 
        type: 'object', 
        required: ['resetToken', 'newPassword'], 
        properties: { 
          resetToken: { type: 'string' },
          newPassword: { type: 'string', minLength: 6 }
        } 
      } 
    } 
  }, resetPassword);

  const verifyOtpSchema = {
    body: {
      type: 'object',
      required: ['email', 'otp'],
      properties: {
        email: { type: 'string', format: 'email' },
        otp: { type: 'string' }
      }
    }
  };
  fastify.post('/verify-otp', { schema: verifyOtpSchema }, verifyRegistrationOtp);

  const resendOtpSchema = {
    body: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email' },
        phone: { type: 'string' }
      }
    }
  };
  fastify.post('/resend-otp', { schema: resendOtpSchema }, async (req, reply) => {
    // lazy-import to avoid circulars in some test setups
    const { resendOtp } = await import('../controllers/authController.js');
    return resendOtp(req, reply);
  });

  const verifySendchampSchema = {
    body: {
      type: 'object',
      required: ['email', 'reference', 'otp'],
      properties: {
        email: { type: 'string', format: 'email' },
        reference: { type: 'string' },
        otp: { type: 'string' }
      }
    }
  };
  fastify.post('/verify-sendchamp', { schema: verifySendchampSchema }, verifyRegistrationWithReference);

  // Register using Firebase phone verification (client provides Firebase ID token)
  const registerFirebaseSchema = {
    body: {
      type: 'object',
      required: ['idToken', 'name', 'email', 'password', 'role'],
      properties: {
        idToken: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 },
        phone: { type: 'string' },
        role: { type: 'string' }
      }
    }
  };
  fastify.post('/registeruserfirebase', { schema: registerFirebaseSchema }, registerUserWithFirebaseToken);

  // Verify token with remote issuer (try Authorization header first, fallback to JSON body { token })
  fastify.post('/verify-remote', { schema: { body: { type: 'object', properties: { token: { type: 'string' } } } } }, verifyRemoteToken);
  
  // Verify token and return decoded payload (protected)
  fastify.get(
    '/verify',
    {
      preHandler: async (request, reply) => {
        try {
          await request.jwtVerify();
        } catch (err) {
          return reply.code(401).send({ message: 'Unauthorized' });
        }
      },
    },
    async (request, reply) => {
      return reply.send({ success: true, payload: request.user });
    }
  );
}
