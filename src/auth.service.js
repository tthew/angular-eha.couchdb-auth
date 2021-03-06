;(function() {
  'use strict';
  /**
   * @ngdoc service
   * @function
   * @name ehaCouchDbService
   * @module eha.couchdb-auth
   */
  var ngModule = angular
  .module('eha.couchdb-auth.auth.service', [
    'restangular',
    'LocalForageModule',
    'ngCookies'
  ]);

  function CouchDbAuthService(options,
                              Restangular,
                              $log,
                              $q,
                              $localForage,
                              $rootScope) {

    var currentUser;

    // Create a new 'isolate scope' so that we can leverage and wrap angular's
    // sub/pub functionality rather than rolling something ourselves
    var eventBus = $rootScope.$new(true);

    function getSession() {
      return $q.when(Restangular
                      .all('_session')
                      .customGET());
    }

    function signIn(user) {
      return $q.when(Restangular
        .all('_session')
        .customPOST({
          name: user.username,
          password: user.password
        }))
        .then(setCurrentUser)
        .then(function(user) {
          console.log('GOT USER');
          return getSession()
                  .then(function() {
                    return user;
                  });
        })
        .then(function(user) {
          if (!user || !user.ok) {
            $log.log('couchdb:login:failure:unknown');
            return $q.reject(new Error());
          }
          eventBus.$broadcast('authenticationStateChange');
          $log.log('couchdb:login:success', user);
          return user;
        })
        .catch(function(err) {
          if (err.status === 401) {
            $log.log('couchdb:login:failure:invalid-credentials', err);
            return $q.reject(new Error('Invalid Credentials'));
          } else {
            $log.log('couchdb:login:failure:unknown', err);
            return $q.reject(new Error(err));
          }
        });
    }

    function clearLocalUser() {
      currentUser = null;
      return $localForage.removeItem('user');
    }

    function setLocalUser(user) {
      return $localForage.setItem('user', user);
    }

    function getLocalUser() {
      return $localForage.getItem('user');
    }

    function signOut() {
      return $q.when(Restangular
        .all('_session')
        .remove())
        .then(clearLocalUser)
        .finally(function() {
          eventBus.$broadcast('authenticationStateChange');
        });
    }

    function resetPassword(config) {
      if (config.token && config.password) {
        return $q.when(Restangular
                       .all('reset-password')
                       .customPOST({
                         token: config.token,
                         password: config.password
                       }));
      }

      if (config.email) {
        return $q.when(Restangular
                       .all('reset-password')
                       .customPOST({
                         email: config.email,
                         callbackUrl: 'http://localhost:5000/#/reset-password'
                       }));
      }

    }

    function addAccount() {
      return $q.reject('NOT_IMPLEMENTED');
    }

    function updateAccount() {
      return $q.reject('NOT_IMPLEMENTED');
    }

    function removeAccount() {
      return $q.reject('NOT_IMPLEMENTED');
    }

    function decorateUser(user) {
      user.hasRole = function(role) {
        return this.roles.indexOf(role) > -1;
      };

      user.isAdmin = function() {
        return this.hasRole('_admin');
      };
      return user;
    }

    function getCurrentUser() {
      if (currentUser) {
        return $q.when(decorateUser(currentUser));
      }

      return getLocalUser()
        .then(function(user) {
          if (user) {
            currentUser = user;
            return decorateUser(user);
          } else {
            return $q.reject('User not found');
          }
        })
        .then(function(user) {
          return getSession()
            .then(function() {
              return user;
            });
        })
        .catch(function(err) {
          console.log(err);
          return $q.reject(err);
        });
    }

    function setCurrentUser(user) {
      if (user) {
        user = user.plain();
        currentUser = {
          name: user.name,
          roles: user.roles,
          bearerToken: user.bearerToken
        };
        return setLocalUser(user);
      }

      $q.reject('No user found');
    }

    eventBus.$on('unauthorized', function() {
      clearLocalUser();
    });

    return {
      signIn: signIn,
      signOut: signOut,
      resetPassword: resetPassword,
      accounts: {
        add: addAccount,
        update: updateAccount,
        remove: removeAccount
      },
      getSession: getSession,
      getCurrentUser: getCurrentUser,
      on: eventBus.$on.bind(eventBus),
      trigger: eventBus.$broadcast.bind(eventBus)
    };
  }

  ngModule.provider('ehaCouchDbAuthService',
  function ehaCouchDbAuthService($localForageProvider,
                                 ehaCouchDbAuthHttpInterceptorProvider,
                                 $httpProvider) {

    var options = {
      localStorageNamespace: 'eha',
      localStorageStoreName: 'auth'
    };

    this.config = function(config) {
      options = angular.extend(options, config);
      $localForageProvider.config({
        name: options.localStorageNamespace,
        storeName: options.localStorageStoreName
      });

      if (config.interceptor) {
        ehaCouchDbAuthHttpInterceptorProvider.config({
          url: config.url,
          hosts: config.interceptor.hosts
        });
        $httpProvider.interceptors.push('ehaCouchDbAuthHttpInterceptor');
      }
    };

    this.requireAdminUser = function(ehaCouchDbAuthService, $q) {
      return ehaCouchDbAuthService.getCurrentUser()
        .then(function(user) {
          if (user && !user.isAdmin()) {
            ehaCouchDbAuthService.trigger('unauthorized');
            return $q.reject('unauthorized');
          }
          return user;
        })
        .catch(function(err) {
          ehaCouchDbAuthService.trigger('unauthenticated');
          return $q.reject('unauthenticated');
        });
    };

    this.requireAuthenticatedUser = function(ehaCouchDbAuthService, $q) {
      return ehaCouchDbAuthService.getCurrentUser()
                .then(function(user) {
                  return user;
                })
                .catch(function(err) {
                  ehaCouchDbAuthService.trigger('unauthenticated');
                  return $q.reject('unauthenticated');
                });
    };

    this.$get = function(Restangular, $log, $q, $localForage, $rootScope) {

      var restangular = Restangular.withConfig(
        function(RestangularConfigurer) {
          RestangularConfigurer.setBaseUrl(options.url);
          if (options.defaultHttpFields) {
            RestangularConfigurer
              .setDefaultHttpFields(options.defaultHttpFields);
          }
        }
      );

      return new CouchDbAuthService(options,
                                    restangular,
                                    $log,
                                    $q,
                                    $localForage,
                                    $rootScope);
    };

  });

  // Check for and export to commonjs environment
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ngModule;
  }

})();
